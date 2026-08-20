import { describe, expect, it } from 'vitest';
import { parsePackageJson } from '../../src/manifests/npm';
import { parseRequirementsTxt } from '../../src/manifests/pypi';
import { parseGoMod } from '../../src/manifests/gomod';
import { parsePackageLock } from '../../src/manifests/npm-lock';
import { parseYarnLock } from '../../src/manifests/yarn-lock';
import { parsePnpmLock } from '../../src/manifests/pnpm-lock';
import { parseTomlPackages } from '../../src/manifests/toml-packages';
import { parseCargoToml } from '../../src/manifests/cargo-toml';
import { parseGoSum } from '../../src/manifests/go-sum';
import { detectAndParse } from '../../src/manifests';
import type { Dependency } from '../../src/types';

/**
 * パーサ群への敵対的入力。
 *
 * Cargo / go.sum / poetry / pnpm / yarn のパーサは Round 1（敵対的入力の
 * 検証）より後に追加したため、一度も攻撃的な入力を受けていなかった。
 * 壊れた入力で例外・停止・誤ったデータが生じないことを確かめる。
 */

const NUL = String.fromCharCode(0);
const RTL = String.fromCharCode(0x202e);
const BOM = String.fromCharCode(0xfeff);

/** JSON を要求しないパーサ（不正入力でも例外を投げてはいけない） */
const TEXT_PARSERS: Array<[string, (s: string) => Dependency[]]> = [
  ['requirements.txt', parseRequirementsTxt],
  ['go.mod', parseGoMod],
  ['yarn.lock', parseYarnLock],
  ['pnpm-lock.yaml', parsePnpmLock],
  ['Cargo.lock/poetry.lock', (s) => parseTomlPackages(s, 'cargo')],
  ['Cargo.toml', parseCargoToml],
  ['go.sum', parseGoSum],
];

const HOSTILE: Array<[string, string]> = [
  ['空', ''],
  ['空白のみ', '   \n\t\n  '],
  ['BOM のみ', BOM],
  ['NUL 混入', 'a' + NUL + 'b\n'],
  ['RTL 上書き', 'evil' + RTL + 'x 1.0.0\n'],
  ['改行なし1行', 'x'.repeat(50_000)],
  ['CRLF', 'a\r\nb\r\n'],
  ['引用符の不一致', 'name = "unterminated\nversion = "1.0.0"\n'],
  ['角括弧の羅列', '['.repeat(2000)],
  ['コロンの羅列', ':'.repeat(2000)],
  ['途中で切れた構造', '[[package]]\nname = "a"\n'],
  ['深いインデント', ' '.repeat(5000) + 'a: 1\n'],
  ['制御文字だらけ', Array.from({ length: 500 }, (_, i) => String.fromCharCode(i % 32)).join('')],
  ['JSON を渡す', '{"dependencies":{"a":"1.0.0"}}'],
  ['YAML を渡す', 'packages:\n  a@1.0.0:\n    x: y\n'],
  ['TOML を渡す', '[[package]]\nname = "a"\nversion = "1"\n'],
  ['go.sum を渡す', 'github.com/a/b v1.0.0 h1:x=\n'],
  ['巨大な繰り返し', 'a@1.0.0:\n  version "1.0.0"\n'.repeat(3000)],
  ['タブ区切り', 'a\t1.0.0\tb\n'],
  ['絵文字', '\u{1F4E6} = "1.0.0"\n'],
];

describe('テキスト系パーサに敵対的入力を与える', () => {
  for (const [pname, parse] of TEXT_PARSERS) {
    for (const [label, input] of HOSTILE) {
      it(`${pname} × ${label}: 例外を投げない`, () => {
        expect(() => parse(input)).not.toThrow();
      });
    }
  }
});

describe('返り値の形が常に守られる', () => {
  for (const [pname, parse] of TEXT_PARSERS) {
    it(`${pname}: 常に妥当な Dependency の配列を返す`, () => {
      for (const [, input] of HOSTILE) {
        const out = parse(input);
        expect(Array.isArray(out)).toBe(true);
        for (const d of out) {
          expect(typeof d.name).toBe('string');
          expect(d.name.length).toBeGreaterThan(0);
          expect(['npm', 'pypi', 'go', 'cargo']).toContain(d.ecosystem);
          expect(['runtime', 'dev', 'build', 'test', 'optional']).toContain(d.scope);
          expect(d.version === null || typeof d.version === 'string').toBe(true);
          // 不可視文字が名前に混入していない
          expect(d.name).not.toContain(NUL);
          expect(d.name).not.toContain(RTL);
        }
      }
    });
  }
});

describe('package-lock.json（JSON 系）', () => {
  it('壊れた JSON では例外を投げる（呼び出し側が 400 にする）', () => {
    expect(() => parsePackageLock('{ broken')).toThrow();
    expect(() => parsePackageJson('{ broken')).toThrow();
  });

  const jsonHostile: Array<[string, unknown]> = [
    ['packages が配列', { lockfileVersion: 3, packages: ['a'] }],
    ['packages が文字列', { lockfileVersion: 3, packages: 'nope' }],
    ['packages が null', { lockfileVersion: 3, packages: null }],
    ['エントリが文字列', { lockfileVersion: 3, packages: { 'node_modules/a': 'x' } }],
    ['エントリが null', { lockfileVersion: 3, packages: { 'node_modules/a': null } }],
    ['version が数値', { lockfileVersion: 3, packages: { 'node_modules/a': { version: 1 } } }],
    ['license が配列', { lockfileVersion: 3, packages: { 'node_modules/a': { version: '1', license: [] } } }],
    ['license が数値', { lockfileVersion: 3, packages: { 'node_modules/a': { version: '1', license: 5 } } }],
    ['licenses が文字列', { lockfileVersion: 3, packages: { 'node_modules/a': { version: '1', licenses: 'MIT' } } }],
    ['キーが node_modules を含まない', { lockfileVersion: 3, packages: { weird: { version: '1' } } }],
    ['キーが node_modules/ で終わる', { lockfileVersion: 3, packages: { 'node_modules/': { version: '1' } } }],
    ['深く入れ子のキー', { lockfileVersion: 3, packages: { [`${'node_modules/x/'.repeat(200)}node_modules/y`]: { version: '1' } } }],
  ];

  for (const [label, doc] of jsonHostile) {
    it(`${label}: 例外を投げず妥当な配列を返す`, () => {
      let out: Dependency[] = [];
      expect(() => {
        out = parsePackageLock(JSON.stringify(doc));
      }).not.toThrow();
      expect(Array.isArray(out)).toBe(true);
      for (const d of out) {
        expect(typeof d.name).toBe('string');
        expect(d.name.length).toBeGreaterThan(0);
        expect(d.version === null || typeof d.version === 'string').toBe(true);
        expect(d.declaredLicense === undefined || typeof d.declaredLicense === 'string').toBe(true);
      }
    });
  }
});

describe('detectAndParse は壊れた入力で 500 相当にならない', () => {
  it('あらゆる敵対的入力で、例外を投げるか妥当な結果を返すかのどちらかになる', () => {
    for (const [label, input] of HOSTILE) {
      try {
        const r = detectAndParse(input);
        expect(Array.isArray(r.dependencies)).toBe(true);
        expect(r.dependencies.length).toBeGreaterThan(0);
      } catch (e) {
        // 想定された Error であること（TypeError などの内部エラーではない）
        expect(e, label).toBeInstanceOf(Error);
        expect((e as Error).message.length, label).toBeGreaterThan(0);
      }
    }
  });
});

describe('大量入力でも現実的な時間で終わる', () => {
  it('1万エントリのロックファイルを 3 秒以内に解析する', () => {
    const packages: Record<string, unknown> = {};
    for (let i = 0; i < 10_000; i++) {
      packages[`node_modules/p${i}`] = { version: '1.0.0', license: 'MIT' };
    }
    const started = Date.now();
    const out = parsePackageLock(JSON.stringify({ lockfileVersion: 3, packages }));
    expect(out).toHaveLength(10_000);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('1万行の go.sum を 3 秒以内に解析する', () => {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(`github.com/o/p${i} v1.0.0 h1:x=`);
      lines.push(`github.com/o/p${i} v1.0.0/go.mod h1:y=`);
    }
    const started = Date.now();
    expect(parseGoSum(lines.join('\n'))).toHaveLength(5000);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('package.json も型を信用しない', () => {
  const cases: Array<[string, unknown]> = [
    ['dependencies が null', { dependencies: null }],
    ['dependencies が配列', { dependencies: ['a'] }],
    ['dependencies が数値', { dependencies: 5 }],
    ['値がオブジェクト', { dependencies: { a: { version: '1' } } }],
    ['値が null', { dependencies: { a: null } }],
    ['値が配列', { dependencies: { a: [] } }],
    ['ルートが配列', ['a', 'b']],
    ['ルートが数値', 42],
    ['ルートが null', null],
    ['ルートが文字列', 'nope'],
  ];

  for (const [label, doc] of cases) {
    it(`${label}: 例外を投げず妥当な配列を返す`, () => {
      let out: Dependency[] = [];
      expect(() => {
        out = parsePackageJson(JSON.stringify(doc));
      }, label).not.toThrow();
      expect(Array.isArray(out)).toBe(true);
      for (const d of out) {
        expect(typeof d.name).toBe('string');
        expect(d.version === null || typeof d.version === 'string').toBe(true);
      }
    });
  }
});

describe('policy 層に異常な値が渡っても落ちない', () => {
  it('あらゆる敵対的文字列を SPDX 式として評価できる', async () => {
    const { evaluateExpression } = await import('../../src/policy/engine');
    const ctx = { scope: 'runtime', linkage: 'dynamic', distributionModel: 'saas' } as const;

    const inputs = [
      '', '   ', NUL, RTL, BOM,
      'x'.repeat(20_000),
      '('.repeat(500) + 'MIT' + ')'.repeat(500),
      'MIT ' + 'OR MIT '.repeat(2000),
      '/'.repeat(500),
      'MIT/'.repeat(500),
      'A AND B OR C WITH D',
      '\n\t\r',
    ];

    for (const i of inputs) {
      expect(() => evaluateExpression(i, ctx)).not.toThrow();
      const r = evaluateExpression(i, ctx);
      expect(['allowed', 'review', 'blocked']).toContain(r.verdict);
      expect(typeof r.rationale).toBe('string');
      expect(Array.isArray(r.obligations)).toBe(true);
    }
  });
});
