import { describe, expect, it } from 'vitest';
import { LicenseCache } from '../../src/resolver/cache';
import type { Dependency } from '../../src/types';

/** D1Database の最小スタブ */
function fakeDb() {
  const rows = new Map<string, { spdx: string | null; source: string }>();
  const calls = { get: 0, put: 0 };

  const db = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              calls.get += 1;
              const key = args.slice(0, 3).join('|');
              const row = rows.get(key);
              return row ? ({ ...row, resolved_at: Date.now() } as T) : null;
            },
            async run() {
              calls.put += 1;
              const [ecosystem, pkg, version, spdx, source] = args as Array<string | null>;
              rows.set(`${ecosystem}|${pkg}|${version}`, {
                spdx: spdx ?? null,
                source: source ?? 'registry',
              });
              return { success: true };
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as D1Database, calls, rows };
}

const dep = (over: Partial<Dependency> = {}): Dependency => ({
  ecosystem: 'npm',
  name: 'express',
  version: '4.18.2',
  scope: 'runtime',
  ...over,
});

describe('LicenseCache', () => {
  it('未登録なら null を返す', async () => {
    const { db } = fakeDb();
    const cache = new LicenseCache(db);
    expect(await cache.get(dep())).toBeNull();
  });

  it('put した値を get で取得できる', async () => {
    const { db } = fakeDb();
    const cache = new LicenseCache(db);
    await cache.put(dep(), 'MIT', 'registry');
    expect(await cache.get(dep())).toEqual({ spdx: 'MIT', source: 'registry' });
  });

  it('version が null の依存はキャッシュしない（キーが定まらないため）', async () => {
    const { db, calls } = fakeDb();
    const cache = new LicenseCache(db);
    await cache.put(dep({ version: null }), 'MIT', 'registry');
    expect(calls.put).toBe(0);
    expect(await cache.get(dep({ version: null }))).toBeNull();
    expect(calls.get).toBe(0);
  });
});
