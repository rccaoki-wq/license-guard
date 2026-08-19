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
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: 'MIT', resolvedFrom: 'cache' });
    expect(npm).not.toHaveBeenCalled();
  });

  it('キャッシュミス時はエコシステムに応じたフェッチャを呼びキャッシュに書く', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => 'Apache-2.0');
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: 'Apache-2.0', resolvedFrom: 'registry' });
    expect(npm).toHaveBeenCalledOnce();
    expect(cache.store.size).toBe(1);
  });

  it('go は clearlydefined を出典として記録する', async () => {
    const cache = stubCache();
    const go = vi.fn(async () => 'BSD-3-Clause');
    const r = new LicenseResolver(cache, { npm: vi.fn(), pypi: vi.fn(), go });

    const out = await r.resolve(
      dep({ ecosystem: 'go', name: 'github.com/a/b', version: 'v1.0.0' }),
    );
    expect(out.resolvedFrom).toBe('clearlydefined');
  });

  it('解決できない場合は unresolved を返す', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => null);
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: null, resolvedFrom: 'unresolved' });
  });

  it('フェッチャが例外を投げても unresolved に落とす', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => {
      throw new Error('network down');
    });
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out.resolvedFrom).toBe('unresolved');
  });

  it('resolveAll は全依存を解決する', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => 'MIT');
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolveAll([dep(), dep({ name: 'hono', version: '4.6.0' })]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.spdx === 'MIT')).toBe(true);
  });
});
