import { describe, expect, it, vi } from 'vitest';
import { LicenseCache } from '../../src/resolver/cache';
import type { Dependency } from '../../src/types';

function fakeDb(rows: Array<Record<string, unknown>>) {
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return {
        bind(...args: unknown[]) {
          return {
            async all<T>() {
              const eco = args[0] as string;
              const names = new Set(args.slice(1) as string[]);
              return {
                results: rows.filter(
                  (r) => r['ecosystem'] === eco && names.has(r['package'] as string),
                ) as T[],
              };
            },
            async first() { return null; },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, queries };
}

const dep = (name: string, version: string | null = '1.0.0'): Dependency => ({
  ecosystem: 'npm',
  name,
  version,
  scope: 'runtime',
});

const row = (pkg: string, spdx: string) => ({
  ecosystem: 'npm',
  package: pkg,
  version: '1.0.0',
  spdx,
  source: 'registry',
  resolved_at: Date.now(),
});

describe('getMany（一括キャッシュ照会）', () => {
  it('該当するものだけを返す', async () => {
    const { db } = fakeDb([row('a', 'MIT'), row('b', 'Apache-2.0')]);
    const found = await new LicenseCache(db).getMany([dep('a'), dep('b'), dep('c')]);
    expect(found.get('npm|a|1.0.0')).toEqual({ spdx: 'MIT', source: 'registry' });
    expect(found.get('npm|b|1.0.0')).toEqual({ spdx: 'Apache-2.0', source: 'registry' });
    expect(found.has('npm|c|1.0.0')).toBe(false);
  });

  it('バージョン未確定のものは対象外', async () => {
    const { db } = fakeDb([row('a', 'MIT')]);
    const found = await new LicenseCache(db).getMany([dep('a', null)]);
    expect(found.size).toBe(0);
  });

  it('大量の依存を分割して問い合わせる（SQLのパラメータ上限対策）', async () => {
    const { db, queries } = fakeDb([]);
    const deps = Array.from({ length: 450 }, (_, i) => dep('p' + i));
    await new LicenseCache(db).getMany(deps);
    expect(queries.length).toBeGreaterThan(1);
  });

  it('エコシステムごとに分けて問い合わせる', async () => {
    const { db } = fakeDb([row('a', 'MIT')]);
    const found = await new LicenseCache(db).getMany([
      dep('a'),
      { ecosystem: 'pypi', name: 'a', version: '1.0.0', scope: 'runtime' },
    ]);
    expect(found.has('npm|a|1.0.0')).toBe(true);
    expect(found.has('pypi|a|1.0.0')).toBe(false);
  });

  it('D1 のバインドパラメータ上限（100）を超えない', async () => {
    // 超えるとクエリ自体が失敗し、catch に飲まれて無音でキャッシュが効かなくなる
    const maxParams: number[] = [];
    const db = {
      prepare() {
        return {
          bind(...args: unknown[]) {
            maxParams.push(args.length);
            return { async all() { return { results: [] }; } };
          },
        };
      },
    } as unknown as D1Database;

    const deps = Array.from({ length: 500 }, (_, i) => dep('p' + i));
    await new LicenseCache(db).getMany(deps);

    expect(maxParams.length).toBeGreaterThan(1);
    expect(Math.max(...maxParams)).toBeLessThanOrEqual(100);
  });

  it('DB 障害時は空を返す（解決処理を壊さない）', async () => {
    const db = {
      prepare() {
        return { bind() { return { async all() { throw new Error('down'); } }; } };
      },
    } as unknown as D1Database;
    expect((await new LicenseCache(db).getMany([dep('a')])).size).toBe(0);
  });

  it('期限切れの registry-latest は返さない', async () => {
    const stale = { ...row('a', 'MIT'), source: 'registry-latest', resolved_at: 0 };
    const { db } = fakeDb([stale]);
    expect((await new LicenseCache(db).getMany([dep('a')])).size).toBe(0);
  });
});
