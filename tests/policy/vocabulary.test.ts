import { describe, expect, it } from 'vitest';
import { categorize } from '../../src/policy/categories';
import { normalizeExpressionOperands, normalizeLicenseString } from '../../src/policy/normalize';
import { evaluateExpression } from '../../src/policy/engine';
import type { PolicyContext } from '../../src/types';

const ctx: PolicyContext = {
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
};

describe('SPDX 語彙の網羅', () => {
  it('実在するがマイナーな permissive を認識する', () => {
    for (const id of [
      'BlueOak-1.0.0',
      'BSL-1.0',
      'Artistic-2.0',
      'NCSA',
      'X11',
      'libpng',
      'Ruby',
      'PostgreSQL',
    ]) {
      expect(categorize(id), id).toBe('permissive');
    }
  });

  it('条項を持たないものは permissive でなく public domain 相当にする', () => {
    // permissive に置くと attribution が付く。WTFPL の唯一の条項は
    // 「好きにしろ」で、著作権表示の保持を求めていない
    expect(categorize('WTFPL')).toBe('public-domain');
    expect(categorize('Unlicense')).toBe('public-domain');
    expect(categorize('0BSD')).toBe('public-domain');
  });

  it('Boost(BSL-1.0) と Business Source(BSL-1.1) を取り違えない', () => {
    // 紛らわしいが片方は permissive、もう片方は商用提供を制限する
    expect(categorize('BSL-1.0')).toBe('permissive');
    expect(categorize('BSL-1.1')).toBe('source-available');
    expect(categorize('BUSL-1.1')).toBe('source-available');
  });
});

describe('npm の旧表記の正規化', () => {
  it('MIT/X11 を MIT に正規化する', () => {
    expect(normalizeLicenseString('MIT/X11')).toBe('MIT');
  });

  it('ライセンス族の総称を、その族に共通する性質で解釈する', () => {
    expect(categorize(normalizeLicenseString('BSD'))).toBe('permissive');
    expect(categorize(normalizeLicenseString('Apache'))).toBe('permissive');
    // 総称の GPL は最も制約の強い解釈に倒す
    expect(categorize(normalizeLicenseString('GPL'))).toBe('strong-copyleft');
    expect(categorize(normalizeLicenseString('LGPL'))).toBe('library-copyleft');
    expect(categorize(normalizeLicenseString('AGPL'))).toBe('network-copyleft');
  });

  it('Public Domain 表記を扱う', () => {
    expect(categorize(normalizeLicenseString('Public Domain'))).toBe('public-domain');
  });

  it('既に SPDX の文字列は変更しない', () => {
    expect(normalizeLicenseString('Apache-2.0')).toBe('Apache-2.0');
    expect(normalizeLicenseString('(MIT OR Apache-2.0)')).toBe('(MIT OR Apache-2.0)');
  });

  it('未知の文字列はそのまま返す（勝手に決めつけない）', () => {
    expect(normalizeLicenseString('Weird-Custom-Thing')).toBe('Weird-Custom-Thing');
  });
});

describe('正規化が判定に効く', () => {
  it('BlueOak-1.0.0 が review でなく allowed になる', () => {
    expect(evaluateExpression('BlueOak-1.0.0', ctx).verdict).toBe('allowed');
  });

  it('MIT/X11 が review でなく allowed になる', () => {
    expect(evaluateExpression('MIT/X11', ctx).verdict).toBe('allowed');
  });

  it('BSD が review でなく allowed になる', () => {
    expect(evaluateExpression('BSD', ctx).verdict).toBe('allowed');
  });

  it('本当に未知のものは review のまま', () => {
    expect(evaluateExpression('Weird-Custom-Thing', ctx).verdict).toBe('review');
  });
});

describe('空白区切りの緩い表記', () => {
  it('ハイフンの代わりに空白を使った SPDX 識別子を認識する', () => {
    expect(normalizeLicenseString('BSD 2-Clause')).toBe('BSD-2-Clause');
    expect(normalizeLicenseString('BSD 3 Clause')).toBe('BSD-3-Clause');
    expect(normalizeLicenseString('GPL 3.0 only')).toBe('GPL-3.0-only');
    expect(normalizeLicenseString('Apache 2.0')).toBe('Apache-2.0');
  });

  it('置換後も未知のものは元の文字列を保つ', () => {
    expect(normalizeLicenseString('Some Custom Thing')).toBe('Some Custom Thing');
  });

  it('緩い表記が判定に反映される', () => {
    expect(evaluateExpression('BSD 2-Clause', ctx).verdict).toBe('allowed');
  });
});

describe('Cargo の旧スラッシュ記法', () => {
  it('スラッシュを OR として解釈する', () => {
    // Cargo は SPDX 式を採用する前、"/" を OR の意味で使っていた
    expect(normalizeLicenseString('MIT/Apache-2.0')).toBe('(MIT OR Apache-2.0)');
    expect(normalizeLicenseString('Unlicense/MIT')).toBe('(Unlicense OR MIT)');
  });

  it('両側が既知でなければ触らない', () => {
    expect(normalizeLicenseString('Weird/Thing')).toBe('Weird/Thing');
  });

  it('MIT/X11 は従来どおり MIT に寄せる（別名として扱う）', () => {
    expect(normalizeLicenseString('MIT/X11')).toBe('MIT');
  });

  it('判定が review でなく allowed になる', () => {
    expect(evaluateExpression('Unlicense/MIT', ctx).verdict).toBe('allowed');
    expect(evaluateExpression('MIT/Apache-2.0', ctx).verdict).toBe('allowed');
  });

  it('Unicode-3.0 を permissive として認識する', () => {
    expect(categorize('Unicode-3.0')).toBe('permissive');
    expect(evaluateExpression('(MIT OR Apache-2.0) AND Unicode-3.0', ctx).verdict).toBe('allowed');
  });
});

describe('上位パッケージが実際に宣言している識別子', () => {
  // 上位 300 PyPI を本番 API に通した実測。review は 7 件で、
  // うち 4 件が「明白に permissive なのに語彙に無い」だけの誤警報だった。
  // **最多ダウンロードの typing-extensions が review になっていた。**
  it.each([
    ['PSF-2.0', 'typing-extensions'],
    ['MIT-CMU', 'pillow'],
    ['MIT AND PSF-2.0', 'greenlet'],
    ['Apache-2.0 AND CNRI-Python', 'regex'],
    // 実 D1 トラフィックより。Rust の TLS スタック
    ['CDLA-Permissive-2.0', 'webpki-roots'],
    ['CDLA-Permissive-1.0', 'データセット系'],
  ])('%s (%s) が allowed になる', (expression) => {
    expect(evaluateExpression(expression, ctx).verdict).toBe('allowed');
  });
});

describe('自分が出す識別子は自分で判定できること', () => {
  /**
   * **これは外部要因の無い自己矛盾のテスト。**
   *
   * PyPI の分類子表は 63 個の SPDX 識別子を出すのに、そのうち 33 個を
   * policy が分類できず一律 review にしていた。解決器は「この分類子は
   * 分かる」と言い、判定器は「知らない」と言う。利用者から見れば、
   * 認識されたはずのライセンスについて何も言えていない。
   *
   * 解決器に識別子を足すときは、判定側の語彙も同時に埋めること。
   */
  it('CLASSIFIER_TO_SPDX が出す識別子はすべて分類できる', async () => {
    const { CLASSIFIER_TO_SPDX } = await import('../../src/resolver/pypi');
    const uncategorized = [...new Set(Object.values(CLASSIFIER_TO_SPDX))]
      .filter((id) => categorize(id) === 'unknown')
      .filter((id) => !DELIBERATELY_UNCLASSIFIED.has(id))
      .sort();
    expect(uncategorized).toEqual([]);
  });

  /**
   * 分からないものを分かったことにしない。ここに置くものは
   * **一つずつ理由を書く。** 数が増えたら、それは語彙を埋める合図。
   */
  const DELIBERATELY_UNCLASSIFIED = new Set([
    // FSF 自身が「曖昧すぎる」と評価している。改変版の配布条件が
    // 複数の解釈を許すので、族に倒すこと自体が主張になる
    'Artistic-1.0',
    // AFPL。有償配布を禁じるが商用利用そのものは禁じていない。
    // non-commercial に倒すとライセンスが言っていないことを言う
    'Aladdin',
    // NASA-1.3。OSI は承認しているが FSF は不自由と評価しており、
    // 評価が割れているものを片方に倒さない
    'NASA-1.3',
  ]);

  it('留保リストには理由が書けるものだけを置く（増えたら語彙を埋める）', () => {
    expect(DELIBERATELY_UNCLASSIFIED.size).toBeLessThanOrEqual(3);
  });
});

describe('似た名前・似た並びに引きずられない', () => {
  it('Sleepycat は permissive でなく strong-copyleft', () => {
    // OSI 承認の分類子表では permissive な名前に囲まれて並んでいるが、
    // Berkeley DB のこれは**アプリケーション全体のソース公開を要求する**。
    // 並びで倒すと、最も強いコピーレフトを permissive として通す
    expect(categorize('Sleepycat')).toBe('strong-copyleft');
  });

  it('OFL-1.1 はフォントに閉じたコピーレフトで permissive ではない', () => {
    expect(categorize('OFL-1.1')).toBe('file-copyleft');
  });

  it('ネットワーク条項を持つものを review で済ませない', () => {
    // OSL-3.0 §5 External Deployment、EUPL 13/14条はいずれも
    // ネットワーク越しの利用を配布とみなす。AGPL と同じ引き金なので、
    // review に落とすのは過小警告になる
    expect(categorize('OSL-3.0')).toBe('network-copyleft');
    expect(categorize('EUPL-1.1')).toBe('network-copyleft');
    expect(categorize('EUPL-1.2')).toBe('network-copyleft');

    const saas = evaluateExpression('EUPL-1.2', ctx);
    expect(saas.obligations).toContain('source-disclosure');
  });

  it('CECILL の B/C/2.1 を同じ強さにしない', () => {
    // 名前は 1 文字違いだが、B は BSD 相当、C は LGPL 相当、
    // 2.1 は GPL 相当で、全部違う
    expect(categorize('CECILL-B')).toBe('permissive');
    expect(categorize('CECILL-C')).toBe('library-copyleft');
    expect(categorize('CECILL-2.1')).toBe('strong-copyleft');
  });
});

describe('式の中の要素の綴り', () => {
  it('要素の綴りだけを SPDX に寄せる', () => {
    expect(normalizeExpressionOperands('BSD 3-Clause OR Apache-2.0')).toBe(
      'BSD-3-Clause OR Apache-2.0',
    );
    expect(normalizeExpressionOperands('(Apache 2.0 AND MIT)')).toBe('(Apache-2.0 AND MIT)');
  });

  it('版を欠く総称には触れない（宣言に無い版を名乗らない）', () => {
    // 単体の "GPL" は GPL-3.0-only に倒したうえで「補った」と開示するが、
    // 式の中では開示する場所が無い。綴りの修正と、版の補完は別のこと
    expect(normalizeExpressionOperands('BSD-3-Clause OR GPL')).toBe('BSD-3-Clause OR GPL');
    expect(normalizeExpressionOperands('MIT AND Apache')).toBe('MIT AND Apache');
  });

  it('WITH の右側（例外 ID）には触れない', () => {
    expect(normalizeExpressionOperands('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(
      'GPL-2.0-only WITH Classpath-exception-2.0',
    );
  });

  it('綴りが違うだけの式が review でなく allowed になる', () => {
    expect(evaluateExpression('BSD 3-Clause OR Apache-2.0', ctx).verdict).toBe('allowed');
  });

  it('綴りを寄せたうえで、読めない要素の救済も効く', () => {
    // 綴り直しと救済は順に効くこと。先に綴りを寄せないと、
    // 読める側まで「読めなかった」側に落ちる
    const r = evaluateExpression('Apache 2.0 AND NOASSERTION', ctx);
    expect(r.obligations).toContain('patent-grant');
    expect(r.rationale).toContain('could not be read');
  });
});
