import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/policy/engine';
import { ALL_DISTRIBUTION_MODELS, verdictMatrix } from '../../src/policy/matrix';
import type { PolicyContext } from '../../src/types';

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
  ...over,
});

describe('evaluateExpression', () => {
  it('単一ライセンスをそのまま判定する', () => {
    expect(evaluateExpression('MIT', ctx()).verdict).toBe('allowed');
  });

  it('OR は最も緩い判定を採る', () => {
    expect(
      evaluateExpression('(MIT OR GPL-3.0-only)', ctx({ distributionModel: 'distributed-binary' }))
        .verdict,
    ).toBe('allowed');
  });

  it('AND は最も厳しい判定を採る', () => {
    expect(evaluateExpression('(MIT AND AGPL-3.0-only)', ctx()).verdict).toBe('blocked');
  });

  it('AND の義務は合算される', () => {
    const r = evaluateExpression('(MIT AND Apache-2.0)', ctx());
    expect(r.obligations).toContain('attribution');
    expect(r.obligations).toContain('notice-file');
  });

  it('GPL-2.0+ のような plus 記法を扱える', () => {
    expect(
      evaluateExpression('GPL-2.0+', ctx({ distributionModel: 'distributed-binary' })).verdict,
    ).toBe('blocked');
  });

  it('Classpath 例外つき GPL は静的リンクでも blocked にしない', () => {
    const r = evaluateExpression(
      'GPL-2.0-only WITH Classpath-exception-2.0',
      ctx({ distributionModel: 'distributed-binary', linkage: 'static' }),
    );
    expect(r.verdict).not.toBe('blocked');
  });

  it('パース不能な式は review にする', () => {
    const r = evaluateExpression('!!! not an spdx expression !!!', ctx());
    expect(r.verdict).toBe('review');
  });

  it('null は blocked（ライセンス不明＝全権利留保）', () => {
    const r = evaluateExpression(null, ctx());
    expect(r.verdict).toBe('blocked');
  });
});

describe('版を欠く総称は、補ったことを言う', () => {
  it('LGPL は判定を変えずに、補ったことを構造化して返す', () => {
    const bare = evaluateExpression('LGPL', ctx({ distributionModel: 'distributed-binary' }));
    const explicit = evaluateExpression(
      'LGPL-3.0-only',
      ctx({ distributionModel: 'distributed-binary' }),
    );

    // 判定・義務・説明はそのまま。足すのは「補った」という事実だけ
    expect(bare.verdict).toBe(explicit.verdict);
    expect(bare.obligations).toEqual(explicit.obligations);
    expect(bare.rationale).toBe(explicit.rationale);

    expect(bare.assumption).toEqual({ declared: 'LGPL', assumed: 'LGPL-3.0-only' });
  });

  it('GPL / AGPL / BSD / Apache / MPL / EPL も同じ扱い', () => {
    for (const [declared, assumed] of [
      ['GPL', 'GPL-3.0-only'],
      ['AGPL', 'AGPL-3.0-only'],
      ['BSD', 'BSD-3-Clause'],
      ['Apache', 'Apache-2.0'],
      ['MPL', 'MPL-2.0'],
      ['EPL', 'EPL-2.0'],
    ] as const) {
      const r = evaluateExpression(declared, ctx({ distributionModel: 'distributed-binary' }));
      expect(r.assumption).toEqual({ declared, assumed });
    }
  });

  it('版まで宣言されているものには何も足さない', () => {
    for (const declared of ['MIT', 'Apache-2.0', 'GPL-3.0-only', 'BSD-3-Clause', 'LGPL-2.1-only']) {
      const r = evaluateExpression(declared, ctx({ distributionModel: 'distributed-binary' }));
      expect(r.assumption).toBeUndefined();
    }
  });

  it('大小文字が違っても拾う（PyPI は "bsd" と書く）', () => {
    expect(evaluateExpression('bsd', ctx()).assumption).toEqual({
      declared: 'bsd',
      assumed: 'BSD-3-Clause',
    });
  });

  it('表は全行に同じ断りを載せる（1 行だけ見て描いても落ちない）', () => {
    const rows = verdictMatrix('LGPL', 'runtime', 'dynamic');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.assumption).toEqual({ declared: 'LGPL', assumed: 'LGPL-3.0-only' });
    }
    // 表の Why に定型文を 5 回並べない
    for (const row of rows) {
      expect(row.rationale).not.toContain('does not name a specific version');
    }
  });
});

describe('OR の選択は宣言順に左右されない', () => {
  /**
   * 判定が同じとき、以前は**宣言順で左のものが残っていた**。
   * `Apache-2.0 OR MIT` は上位 300 クレート中 23 件あり（`MIT OR Apache-2.0`
   * と同じ意味）、そのすべてで MIT を選べば要らない `notice-file` と
   * `patent-grant` が「least restrictive option」として表示されていた。
   */
  it('書き方の違いで結果が変わらない（serde と fnv の実データ）', () => {
    for (const model of ALL_DISTRIBUTION_MODELS) {
      const a = evaluateExpression('MIT OR Apache-2.0', ctx({ distributionModel: model }));
      const b = evaluateExpression('Apache-2.0 OR MIT', ctx({ distributionModel: model }));
      expect(b.obligations).toEqual(a.obligations);
      expect(b.verdict).toBe(a.verdict);
    }
  });

  it('緩い方を採る＝MIT を選ぶ。Apache-2.0 の追加義務は出さない', () => {
    const r = evaluateExpression('Apache-2.0 OR MIT', ctx());
    expect(r.obligations).toEqual(['attribution']);
  });

  it('3 つ以上でも順に左右されない（Apache-2.0 OR ISC OR MIT の実データ）', () => {
    const r = evaluateExpression('Apache-2.0 OR ISC OR MIT', ctx());
    expect(r.obligations).not.toContain('notice-file');
  });

  /**
   * **表は 1 つの選択で読めなければならない。**
   *
   * 以前は行ごとに別のライセンスを選んでいた。`GPL-3.0-only OR MIT` は
   * saas と internal-only では GPL（その用途では義務が発火しないので
   * 義務ゼロ）、distributed-binary では MIT を選んでいた。行ごとには
   * 正しいが、**どの単一の選択でも再現できない表**になる。読み手は
   * 1 つを選んで全用途で使うので、選択は表全体で 1 つに固定する。
   */
  it('配布形態が変わっても同じライセンスを選ぶ', () => {
    const rows = verdictMatrix('GPL-3.0-only OR MIT');
    for (const r of rows) expect(r.obligations).toEqual(['attribution']);
  });

  it('緩い側が blocked なら、判定を優先して厳しい側を採る', () => {
    // 判定は今も第一基準。緩さの比較は判定が並んだときだけ働く
    const r = evaluateExpression('AGPL-3.0-only OR MIT', ctx());
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toEqual(['attribution']);
  });
});

describe('式の一部が読めなくても、読めた側は捨てない', () => {
  /**
   * 以前は `parse()` が失敗した時点で式全体を捨て、
   * verdict=review / obligations=[] を返していた。**単一の識別子に
   * 見えるものだけを救済していたので、演算子を含む式は丸ごと失われた。**
   *
   * これは両方向に壊れる。読める側が緩ければ過剰警告になり、
   * 読める側が厳しければ**過小警告になる** —— 後者が危ない。
   */

  it('AND の読めた側の義務を消さない（AGPL を review で素通ししない）', () => {
    // 実 D1 トラフィック: mattermost-server は
    // "AGPL-3.0 AND ... AND NOASSERTION" を宣言している。
    // NOASSERTION が読めないだけで、**AGPL には一言も触れずに
    // review / 義務ゼロ**を返していた
    const r = evaluateExpression('AGPL-3.0 AND NOASSERTION', ctx());
    expect(r.verdict).toBe('blocked');
    expect(r.obligations).toContain('source-disclosure');
    expect(r.rationale).toContain('AGPL-3.0');
  });

  it('OR の読める選択肢を採る（docutils を review に積まない）', () => {
    // 実測: 上位 300 PyPI の docutils は "BSD-3-Clause OR GPL"。
    // BSD がそこに書いてあるのに、GPL の版が読めないという理由で
    // 式全体を捨てていた
    const r = evaluateExpression('BSD-3-Clause OR GPL', ctx());
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toContain('attribution');
  });

  it('読めなかった部分を黙って落とさない', () => {
    for (const expression of ['AGPL-3.0 AND NOASSERTION', 'BSD-3-Clause OR GPL']) {
      const r = evaluateExpression(expression, ctx());
      expect(r.rationale, expression).toMatch(/could not be read/i);
    }
  });

  it('OR で「読めない方」を緩い選択肢として選ばない', () => {
    // 読めないものは review（義務ゼロ）として評価されるので、
    // 判定の軽さだけで選ぶと **blocked な AGPL より「緩い」ことになる。**
    // 選べない選択肢を選んだことにするのは、過小警告そのもの
    const r = evaluateExpression('AGPL-3.0 OR NOASSERTION', ctx());
    expect(r.verdict).toBe('blocked');
    expect(r.obligations).toContain('source-disclosure');
  });

  it('救済しても、読めた側だけで出る答えより緩くならない', () => {
    for (const model of ALL_DISTRIBUTION_MODELS) {
      const severity = { allowed: 0, review: 1, blocked: 2 } as const;
      const partial = evaluateExpression('GPL-3.0-only AND NOASSERTION', ctx({ distributionModel: model }));
      const readable = evaluateExpression('GPL-3.0-only', ctx({ distributionModel: model }));
      expect(severity[partial.verdict], model).toBeGreaterThanOrEqual(severity[readable.verdict]);
      for (const o of readable.obligations) expect(partial.obligations, model).toContain(o);
    }
  });

  it('知らない例外が付いた式は救済しない（例外を無かったことにしない）', () => {
    // WITH の右側は例外 ID であってライセンスではない。ここを
    // 「読めない部分」として外すと、**例外で緩和されたかのように
    // 見える答え**を返しかねない。式ごと review に落とす
    const r = evaluateExpression('GPL-3.0-only WITH Nonexistent-Exception-9.9', ctx());
    expect(r.verdict).toBe('review');
  });

  it('読める要素が一つも無ければ従来どおり review', () => {
    const r = evaluateExpression('Frobnicate-1.0 AND Whatsit-2.0', ctx());
    expect(r.verdict).toBe('review');
    expect(r.obligations).toEqual([]);
  });
});
