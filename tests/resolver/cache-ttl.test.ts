import { describe, expect, it } from 'vitest';
import { LicenseCache, LATEST_FALLBACK_TTL_MS } from '../../src/resolver/cache';
import type { Dependency } from '../../src/types';

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  const store = [...rows];
  const db = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              const [eco, pkg, ver] = args as string[];
              return (store.find(
                (r) => r['ecosystem'] === eco && r['package'] === pkg && r['version'] === ver,
              ) as T) ?? null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

const dep: Dependency = {
  ecosystem: 'npm',
  name: 'express',
  version: '1.0.0',
  scope: 'runtime',
};

const row = (source: string, ageMs: number) => ({
  ecosystem: 'npm',
  package: 'express',
  version: '1.0.0',
  spdx: 'MIT',
  source,
  resolved_at: Date.now() - ageMs,
});

describe('可変な情報源から得た結果は期限付きで扱う', () => {
  it('固定版由来のキャッシュは古くても使う（そのバージョンの事実は不変）', async () => {
    const cache = new LicenseCache(fakeDb([row('registry', 10 * 365 * 24 * 3600_000)]));
    expect(await cache.get(dep)).toEqual({ spdx: 'MIT', source: 'registry' });
  });

  it('clearlydefined 由来も同様に不変として扱う', async () => {
    const cache = new LicenseCache(fakeDb([row('clearlydefined', 10 * 365 * 24 * 3600_000)]));
    expect((await cache.get(dep))?.source).toBe('clearlydefined');
  });

  it('最新版由来のキャッシュは期限内なら使う', async () => {
    const cache = new LicenseCache(fakeDb([row('registry-latest', LATEST_FALLBACK_TTL_MS / 2)]));
    expect((await cache.get(dep))?.source).toBe('registry-latest');
  });

  it('最新版由来のキャッシュは期限切れなら無視する（再ライセンスを取り込むため）', async () => {
    const cache = new LicenseCache(fakeDb([row('registry-latest', LATEST_FALLBACK_TTL_MS + 1000)]));
    expect(await cache.get(dep)).toBeNull();
  });

  it('resolved_at が欠けていても落ちない', async () => {
    const cache = new LicenseCache(
      fakeDb([{ ecosystem: 'npm', package: 'express', version: '1.0.0', spdx: 'MIT', source: 'registry-latest' }]),
    );
    expect(await cache.get(dep)).toBeNull();
  });
});
