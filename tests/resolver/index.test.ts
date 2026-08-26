import { describe, expect, it, vi } from 'vitest';
import { LicenseResolver } from '../../src/resolver';
import type { Dependency } from '../../src/types';

const dep = (over: Partial<Dependency> = {}): Dependency => ({
  ecosystem: 'npm',
  name: 'express',
  version: '4.18.2',
  scope: 'runtime',
  ...over,
});

function stubCache() {
  const store = new Map<string, { spdx: string | null; source: string }>();
  return {
    store,
    async get(d: Dependency) {
      if (d.version === null) return null;
      return store.get(`${d.ecosystem}|${d.name}|${d.version}`) ?? null;
    },
    async put(d: Dependency, spdx: string | null, source: string) {
      if (d.version === null) return;
      store.set(`${d.ecosystem}|${d.name}|${d.version}`, { spdx, source });
    },
  };
}

describe('LicenseResolver', () => {
  it('キャッシュヒット時はフェッチャを呼ばない', async () => {
    const cache = stubCache();
    await cache.put(dep(), 'MIT', 'registry');
    const npm = vi.fn();
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const out = await r.resolve(dep());
    // キャッシュ経由でも出所（registry / registry-latest）を保つ
    expect(out).toEqual({ spdx: 'MIT', resolvedFrom: 'registry' });
    expect(npm).not.toHaveBeenCalled();
  });

  it('キャッシュミス時はエコシステムに応じたフェッチャを呼びキャッシュに書く', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => ({ spdx: 'Apache-2.0' }));
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: 'Apache-2.0', resolvedFrom: 'registry' });
    expect(npm).toHaveBeenCalledOnce();
    expect(cache.store.size).toBe(1);
  });

  it('go は clearlydefined を出典として記録する', async () => {
    const cache = stubCache();
    const go = vi.fn(async () => ({ spdx: 'BSD-3-Clause' }));
    const r = new LicenseResolver(cache, { npm: vi.fn(), pypi: vi.fn(), go, cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const out = await r.resolve(
      dep({ ecosystem: 'go', name: 'github.com/a/b', version: 'v1.0.0' }),
    );
    expect(out.resolvedFrom).toBe('clearlydefined');
  });

  it('解決できない場合は unresolved を返す', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => ({ spdx: null }));
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: null, resolvedFrom: 'unresolved' });
  });

  it('フェッチャが例外を投げても unresolved に落とす', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => {
      throw new Error('network down');
    });
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const out = await r.resolve(dep());
    expect(out.resolvedFrom).toBe('unresolved');
  });

  // プライバシー上の約束そのもの。解決できなかった名前は書かない。
  // 公開レジストリに無い社内パッケージは、まさにこの経路を通る。
  // キャッシュは /sitemap.xml の出所でもあるので、ここが緩むと社内名が公開されうる。
  it('解決できなかったパッケージ名はキャッシュに書かない', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => ({ spdx: null }));
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    await r.resolve(dep({ name: '@acme-internal/billing' }));
    expect(cache.store.size).toBe(0);
  });

  it('フェッチャが落ちたときもパッケージ名をキャッシュに書かない', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => {
      throw new Error('network down');
    });
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    await r.resolve(dep({ name: '@acme-internal/billing' }));
    expect(cache.store.size).toBe(0);
  });

  it('resolveAll は全依存を解決する', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => ({ spdx: 'MIT' }));
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const out = await r.resolveAll([dep(), dep({ name: 'hono', version: '4.6.0' })]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.spdx === 'MIT')).toBe(true);
  });
});

describe('キャッシュ書き込みの失敗が読み取りを壊さない', () => {
  it('put が例外を投げても解決結果を返す', async () => {
    // D1 のクォータ枯渇などで書き込みが落ちても、キャッシュは最適化に過ぎず
    // スキャン全体を失敗させてはならない
    const brokenCache = {
      async get() {
        return null;
      },
      async put() {
        throw new Error('D1_ERROR: too many writes');
      },
    };
    const r = new LicenseResolver(brokenCache, {
      npm: async () => ({ spdx: 'MIT' }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
      cargo: async () => ({ spdx: null }),
      rubygems: async () => ({ spdx: null }),
      nuget: async () => ({ spdx: null }),
    });

    expect(await r.resolve(dep())).toEqual({ spdx: 'MIT', resolvedFrom: 'registry' });
  });

  it('get が例外を投げても解決を続行する', async () => {
    const brokenCache = {
      async get(): Promise<null> {
        throw new Error('D1_ERROR: read failed');
      },
      async put() {},
    };
    const r = new LicenseResolver(brokenCache, {
      npm: async () => ({ spdx: 'MIT' }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
      cargo: async () => ({ spdx: null }),
      rubygems: async () => ({ spdx: null }),
      nuget: async () => ({ spdx: null }),
    });

    expect((await r.resolve(dep())).spdx).toBe('MIT');
  });
});
