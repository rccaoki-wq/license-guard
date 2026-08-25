import { describe, expect, it } from 'vitest';
import { parsePackageLock } from '../../src/manifests/npm-lock';
import { detectAndParse, MAX_LOOKUPS } from '../../src/manifests';
import { scan } from '../../src/scan';

const lock = (packages: Record<string, unknown>, version = 3) =>
  JSON.stringify({ name: 'demo', lockfileVersion: version, packages });

describe('parsePackageLock', () => {
  it('埋め込まれたライセンスをそのまま使う（外部照会が不要）', () => {
    const deps = parsePackageLock(
      lock({
        '': { name: 'demo', version: '1.0.0' },
        'node_modules/express': { version: '4.18.2', license: 'MIT' },
      }),
    );
    expect(deps).toEqual([
      {
        ecosystem: 'npm',
        name: 'express',
        version: '4.18.2',
        scope: 'runtime',
        declaredLicense: 'MIT',
      },
    ]);
  });

  it('ルートエントリ（空キー）を依存として扱わない', () => {
    const deps = parsePackageLock(lock({ '': { name: 'demo', version: '1.0.0' } }));
    expect(deps).toEqual([]);
  });

  it('推移的依存を含める（直接依存だけでなく）', () => {
    // AGPL が紛れ込むのは直接依存ではなく推移的依存であることが多い
    const deps = parsePackageLock(
      lock({
        'node_modules/a': { version: '1.0.0', license: 'MIT' },
        'node_modules/a/node_modules/b': { version: '2.0.0', license: 'AGPL-3.0-only' },
      }),
    );
    expect(deps.map((d) => d.name)).toEqual(['a', 'b']);
    expect(deps[1]!.declaredLicense).toBe('AGPL-3.0-only');
  });

  it('スコープ付きパッケージ名を復元する', () => {
    const deps = parsePackageLock(
      lock({ 'node_modules/@types/node': { version: '22.0.0', license: 'MIT' } }),
    );
    expect(deps[0]!.name).toBe('@types/node');
  });

  it('入れ子のスコープ付きも復元する', () => {
    const deps = parsePackageLock(
      lock({
        'node_modules/pkg/node_modules/@scope/inner': { version: '1.0.0', license: 'MIT' },
      }),
    );
    expect(deps[0]!.name).toBe('@scope/inner');
  });

  it('dev / optional のフラグをスコープに反映する', () => {
    const deps = parsePackageLock(
      lock({
        'node_modules/a': { version: '1.0.0', license: 'MIT', dev: true },
        'node_modules/b': { version: '1.0.0', license: 'MIT', optional: true },
        'node_modules/c': { version: '1.0.0', license: 'MIT', devOptional: true },
        'node_modules/d': { version: '1.0.0', license: 'MIT' },
      }),
    );
    expect(deps.map((d) => [d.name, d.scope])).toEqual([
      ['a', 'dev'],
      ['b', 'optional'],
      ['c', 'dev'],
      ['d', 'runtime'],
    ]);
  });

  it('link エントリ（ワークスペース）を除外する', () => {
    const deps = parsePackageLock(
      lock({
        'node_modules/local-pkg': { resolved: 'packages/local', link: true },
        'node_modules/real': { version: '1.0.0', license: 'MIT' },
      }),
    );
    expect(deps.map((d) => d.name)).toEqual(['real']);
  });

  it('license が無いエントリは照会対象として残す', () => {
    const deps = parsePackageLock(
      lock({ 'node_modules/mystery': { version: '1.0.0' } }),
    );
    expect(deps[0]!.declaredLicense).toBeUndefined();
    expect(deps[0]!.version).toBe('1.0.0');
  });

  it('レガシーな licenses 配列も扱う', () => {
    const deps = parsePackageLock(
      lock({
        'node_modules/old': { version: '1.0.0', licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] },
      }),
    );
    expect(deps[0]!.declaredLicense).toBe('(MIT OR GPL-2.0)');
  });

  it('危険な名前を除外する', () => {
    const RTL = String.fromCharCode(0x202e);
    const deps = parsePackageLock(
      lock({
        [`node_modules/evil${RTL}x`]: { version: '1.0.0', license: 'MIT' },
        'node_modules/ok': { version: '1.0.0', license: 'MIT' },
      }),
    );
    expect(deps.map((d) => d.name)).toEqual(['ok']);
  });

  it('lockfileVersion 1（packages 無し）は空を返す', () => {
    expect(parsePackageLock(JSON.stringify({ lockfileVersion: 1, dependencies: {} }))).toEqual([]);
  });
});

describe('detectAndParse がロックファイルを見分ける', () => {
  it('lockfileVersion を持つ JSON はロックファイルとして扱う', () => {
    const r = detectAndParse(
      lock({ 'node_modules/express': { version: '4.18.2', license: 'MIT' } }),
    );
    expect(r.ecosystem).toBe('npm');
    expect(r.dependencies[0]!.declaredLicense).toBe('MIT');
  });

  it('通常の package.json は従来どおり扱う', () => {
    const r = detectAndParse(JSON.stringify({ dependencies: { express: '^4.18.2' } }));
    expect(r.dependencies[0]!.declaredLicense).toBeUndefined();
  });
});

describe('上限超過時のふるまい（scan 経由）', () => {
  // 拒否して何も返さないより、確認できた分を返して未確認を明示する方が有用。
  // 詳細は tests/partial-scan.test.ts
  const emptyCache = { async get() { return null; }, async put() {} };
  const fetchers = {
    npm: async () => ({ spdx: 'MIT' }),
    pypi: async () => ({ spdx: null }),
    go: async () => ({ spdx: null }),
    cargo: async () => ({ spdx: null }),
  };

  it('拒否せず部分的な結果を返す', async () => {
    // 上限は実測で動く（時間の律速が取れれば上げる）。定数に紐付けておかないと、
    // 上限を上げた瞬間にこのテストが「超過していない入力」を検査してしまう
    const n = MAX_LOOKUPS + 51;
    const deps: Record<string, string> = {};
    for (let i = 0; i < n; i++) deps[`p${i}`] = '1.0.0';
    const r = await scan(JSON.stringify({ dependencies: deps }), 'saas', emptyCache, fetchers);
    expect(r.summary.total).toBe(n);
    expect(r.findings.some((f) => f.resolvedFrom === 'not-checked')).toBe(true);
  });

  it('キャッシュに載っていれば未確認は生じない（共有キャッシュの効用）', async () => {
    const packages: Record<string, unknown> = {};
    for (let i = 0; i <= 400; i++) packages[`node_modules/p${i}`] = { version: '1.0.0' };

    const warmCache = {
      async get() { return { spdx: 'MIT', source: 'registry' }; },
      async put() {},
      async getMany(deps: Array<{ ecosystem: string; name: string; version: string | null }>) {
        return new Map(
          deps.map((d) => [`${d.ecosystem}|${d.name}|${d.version}`, { spdx: 'MIT', source: 'registry' }]),
        );
      },
    };

    const r = await scan(JSON.stringify({ lockfileVersion: 3, packages }), 'saas', warmCache, fetchers);
    expect(r.summary.total).toBe(401);
    expect(r.findings.some((f) => f.resolvedFrom === 'not-checked')).toBe(false);
  });
});
