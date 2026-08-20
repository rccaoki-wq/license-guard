import { describe, expect, it, vi } from 'vitest';
import { fetchNpmLicense } from '../../src/resolver/npm';
import { LicenseResolver, type CacheLike } from '../../src/resolver';
import type { Dependency } from '../../src/types';

describe('固定版にライセンス情報が無い場合', () => {
  it('最新版から採り、その旨を fromLatest で示す', async () => {
    // express@1.0.0 は 2012 年の公開で license フィールドが存在しない
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/1.0.0')) return { ok: true, json: async () => ({ version: '1.0.0' }) };
      return { ok: true, json: async () => ({ license: 'MIT' }) };
    }) as unknown as typeof fetch;

    expect(await fetchNpmLicense('express', '1.0.0', f)).toEqual({
      spdx: 'MIT',
      fromLatest: true,
    });
  });

  it('固定版が情報を持つなら最新を引かない', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ license: 'MIT' }) };
    }) as unknown as typeof fetch;

    expect(await fetchNpmLicense('chalk', '1.0.0', f)).toEqual({ spdx: 'MIT' });
    expect(calls).toHaveLength(1);
  });

  it('最新版にも無ければ spdx は null', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    expect((await fetchNpmLicense('nothing', '1.0.0', f)).spdx).toBeNull();
  });
});

describe('LicenseResolver の出所表示', () => {
  const noopCache: CacheLike = {
    async get() {
      return null;
    },
    async put() {},
  };
  const dep = (over: Partial<Dependency> = {}): Dependency => ({
    ecosystem: 'npm',
    name: 'x',
    version: '1.0.0',
    scope: 'runtime',
    ...over,
  });

  it('最新版由来なら registry-latest を返す', async () => {
    const r = new LicenseResolver(noopCache, {
      npm: async () => ({ spdx: 'MIT', fromLatest: true }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
    });
    expect(await r.resolve(dep())).toEqual({ spdx: 'MIT', resolvedFrom: 'registry-latest' });
  });

  it('固定版由来なら registry を返す', async () => {
    const r = new LicenseResolver(noopCache, {
      npm: async () => ({ spdx: 'MIT' }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
    });
    expect(await r.resolve(dep())).toEqual({ spdx: 'MIT', resolvedFrom: 'registry' });
  });

  it('キャッシュヒットでも出所を保つ', async () => {
    const store = new Map<string, { spdx: string | null; source: string }>();
    const cache: CacheLike = {
      async get(d) {
        return store.get(`${d.ecosystem}|${d.name}|${d.version}`) ?? null;
      },
      async put(d, spdx, source) {
        store.set(`${d.ecosystem}|${d.name}|${d.version}`, { spdx, source });
      },
    };
    const r = new LicenseResolver(cache, {
      npm: async () => ({ spdx: 'MIT', fromLatest: true }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
    });

    await r.resolve(dep());
    // 2回目はキャッシュから。出所が registry にすり替わってはいけない
    expect(await r.resolve(dep())).toEqual({ spdx: 'MIT', resolvedFrom: 'registry-latest' });
  });
});
