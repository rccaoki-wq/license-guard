import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import parse from 'spdx-expression-parse';
import { CLASSIFIER_TO_SPDX, fetchPypiLicense } from '../../src/resolver/pypi';
import { categorize } from '../../src/policy/categories';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** 分類子だけを持つパッケージを引く */
async function fromClassifiers(classifiers: string[]): Promise<string | null> {
  const f = mockFetch({
    info: { license: null, license_expression: null, classifiers },
  });
  return (await fetchPypiLicense('foo', null, f)).spdx;
}

/**
 * PyPI が実際に受け付ける分類子の全一覧。
 * `https://pypi.org/pypi?:action=list_classifiers` の License 行をそのまま。
 */
const CANONICAL = new Set(
  // vitest はプロジェクト直下で走る。import.meta.url から組み立てないのは、
  // Workers 向けの global URL 型が node の URL と別物で型検査を通らないため
  readFileSync('tests/fixtures/pypi-license-classifiers.txt', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('License ::'))
    .map((l) => l.replace(/^License :: (OSI Approved :: )?/, '')),
);

describe('分類子の表記', () => {
  it('対応表の見出しは実在する分類子だけにする', () => {
    // 存在しない文字列を鍵にしても型エラーにも実行時例外にもならず、
    // その行は永久に発火しない。実際 `GNU Lesser General Public License (LGPL)`
    // と書いていたが、PyPI が出すのは
    // `GNU Library or Lesser General Public License (LGPL)` で、
    // LGPL を宣言したパッケージが全て「判定不能」になっていた
    const bogus = Object.keys(CLASSIFIER_TO_SPDX).filter((k) => !CANONICAL.has(k));
    expect(bogus).toEqual([]);
  });

  it('対応表の行き先は実在する SPDX 識別子にする', () => {
    // 綴りを間違えても文字列としては通ってしまうので、公式の一覧に
    // 当てて確かめる。parse は識別子そのものを検証する。
    //
    // 「categorize が分類できること」までは求めない。分類語彙に無い
    // 実在ライセンス（OSL-3.0 等）は要確認に落ちるが、名前が出るだけでも
    // 「判定不能」より利用者が調べられる
    const bad = Object.entries(CLASSIFIER_TO_SPDX)
      .filter(([, spdx]) => {
        try {
          parse(spdx);
          return false;
        } catch {
          return true;
        }
      })
      .map(([k, v]) => `${k} -> ${v}`);
    expect(bad).toEqual([]);
  });
});

describe('コピーレフトの分類子を取り違えない', () => {
  // このツールが存在する理由そのもの。ここが解決できないと
  // 「判定不能」に埋もれて、利用者は自分で調べ直すことになる
  const CASES: Array<[string, string]> = [
    ['GNU Library or Lesser General Public License (LGPL)', 'library-copyleft'],
    ['GNU Lesser General Public License v2 (LGPLv2)', 'library-copyleft'],
    ['GNU Lesser General Public License v2 or later (LGPLv2+)', 'library-copyleft'],
    ['GNU Lesser General Public License v3 (LGPLv3)', 'library-copyleft'],
    ['GNU Lesser General Public License v3 or later (LGPLv3+)', 'library-copyleft'],
    ['GNU General Public License v2 (GPLv2)', 'strong-copyleft'],
    ['GNU General Public License v3 (GPLv3)', 'strong-copyleft'],
    ['GNU Affero General Public License v3', 'network-copyleft'],
    ['GNU Affero General Public License v3 or later (AGPLv3+)', 'network-copyleft'],
    ['Mozilla Public License 1.1 (MPL 1.1)', 'file-copyleft'],
    ['Mozilla Public License 2.0 (MPL 2.0)', 'file-copyleft'],
    ['Common Development and Distribution License 1.0 (CDDL-1.0)', 'file-copyleft'],
    ['Eclipse Public License 1.0 (EPL-1.0)', 'file-copyleft'],
    ['Eclipse Public License 2.0 (EPL-2.0)', 'file-copyleft'],
  ];

  for (const [classifier, category] of CASES) {
    it(`${classifier} → ${category}`, async () => {
      const spdx = await fromClassifiers([`License :: OSI Approved :: ${classifier}`]);
      expect(spdx, 'resolved nothing').not.toBeNull();
      expect(categorize(spdx!)).toBe(category);
    });
  }

  it('版を書かない分類子に、勝手な版を補わない', async () => {
    // GPLv2 と GPLv3 は互いに非互換。分からない版を具体的に名乗るのは
    // 「厳しい方に倒す」ではなく別のライセンスだと主張すること。
    // mysql-connector-python は実際 GPLv2 + FOSS 例外なのに
    // GPL-3.0-only と答えていた
    const f = mockFetch({
      info: {
        license: 'GNU GPLv2 (with FOSS License Exception)',
        license_expression: null,
        classifiers: ['License :: OSI Approved :: GNU General Public License (GPL)'],
      },
    });
    const spdx = (await fetchPypiLicense('mysql-connector-python', null, f)).spdx;
    expect(spdx).not.toMatch(/3\.0/);
    // 族までは確かなので、族は答える
    expect(categorize(spdx!)).toBe('strong-copyleft');
  });

  it('AGPL を GPL と取り違えない', async () => {
    // 配布しない SaaS でも第13条が効くのは AGPL だけ。
    // ここを GPL に倒すと、条件が効いているのに効いていないと答える
    const spdx = await fromClassifiers([
      'License :: OSI Approved :: GNU Affero General Public License v3 or later (AGPLv3+)',
    ]);
    expect(spdx).toBe('AGPL-3.0-or-later');
  });
});

describe('分類子が複数あるとき', () => {
  it('書かれた順で最初のものを答えにしない', async () => {
    // PyPI は分類子の順序を著者が書いた通りに保つだけで、優先度は無い。
    // 先勝ちにすると、同じ意味の 2 つのパッケージが並び順だけで
    // 別の答えになる。しかも緩い方が先にあると義務が消える
    const forward = await fromClassifiers([
      'License :: OSI Approved :: MIT License',
      'License :: OSI Approved :: GNU General Public License v3 (GPLv3)',
    ]);
    const reversed = await fromClassifiers([
      'License :: OSI Approved :: GNU General Public License v3 (GPLv3)',
      'License :: OSI Approved :: MIT License',
    ]);
    expect(forward).toBe(reversed);
  });

  it('選択できる形（OR）として返す', async () => {
    // 複数宣言はほぼ常に「どちらかを選べる」。片方を捨てると
    // 選べたことが見えなくなり、両方を AND で繋ぐと過剰に警告する。
    // 式にすれば policy 側が緩い方を選び、利用者には両方が見える
    const spdx = await fromClassifiers([
      'License :: OSI Approved :: MIT License',
      'License :: OSI Approved :: GNU General Public License v3 (GPLv3)',
    ]);
    expect(spdx).toContain(' OR ');
    expect(spdx).toContain('MIT');
    expect(spdx).toContain('GPL-3.0-only');
  });

  it('同じ識別子に落ちる分類子を重ねない', async () => {
    const spdx = await fromClassifiers([
      'License :: OSI Approved :: MIT License',
      'License :: OSI Approved :: MIT License',
    ]);
    expect(spdx).toBe('MIT');
  });

  it('版を特定できない分類子は具体的な方に譲る', async () => {
    // "BSD License" は 2-Clause と 3-Clause を区別しない。
    // 具体的な宣言があるならそちらを使う
    const f = mockFetch({
      info: {
        license: 'BSD-2-Clause',
        classifiers: ['License :: OSI Approved :: BSD License'],
      },
    });
    expect((await fetchPypiLicense('foo', null, f)).spdx).toBe('BSD-2-Clause');
  });

  it('版を特定できない分類子しか無ければそれを使う', async () => {
    expect(await fromClassifiers(['License :: OSI Approved :: BSD License'])).toBe('BSD-3-Clause');
  });
});

describe('実在パッケージの形', () => {
  it('psycopg2-binary の宣言から LGPL を読む', async () => {
    // 自由記述は "LGPL with exceptions" で SPDX ではない。
    // 分類子側が答えを持っている
    const f = mockFetch({
      info: {
        license: 'LGPL with exceptions',
        license_expression: null,
        classifiers: [
          'License :: OSI Approved :: GNU Library or Lesser General Public License (LGPL)',
        ],
      },
    });
    const spdx = (await fetchPypiLicense('psycopg2-binary', null, f)).spdx;
    expect(spdx).not.toBeNull();
    expect(categorize(spdx!)).toBe('library-copyleft');
  });
});
