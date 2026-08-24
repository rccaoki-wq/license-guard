import { describe, expect, it, vi } from 'vitest';
import { fetchGoLicenseWithFallback } from '../../src/resolver/go';
import { LicenseResolver, type Fetchers } from '../../src/resolver/index';
import type { Dependency } from '../../src/types';

const noCache = {
  get: async () => null,
  put: async () => undefined,
};

/** URL の相手先だけで応答を切り替える偽 fetch */
function router(routes: Record<string, unknown | null>) {
  return vi.fn(async (url: string) => {
    const host = url.includes('deps.dev') ? 'depsdev' : 'clearlydefined';
    const body = routes[host];
    if (body == null) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => body };
  }) as unknown as typeof fetch;
}

describe('Go のライセンス出典', () => {
  it('deps.dev が答えたら ClearlyDefined は引かない', async () => {
    const f = router({ depsdev: { licenses: ['Apache-2.0'] } });
    const r = await fetchGoLicenseWithFallback('github.com/x/y', 'v1.0.0', f);

    expect(r.spdx).toBe('Apache-2.0');
    expect(r.source).toBe('deps-dev');
    const urls = (f as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(urls.every((u) => u.includes('deps.dev'))).toBe(true);
  });

  it('deps.dev が答えなければ ClearlyDefined に落ちる', async () => {
    const f = router({
      depsdev: null,
      clearlydefined: { licensed: { declared: 'BSD-3-Clause' } },
    });
    const r = await fetchGoLicenseWithFallback('github.com/x/y', 'v1.0.0', f);

    expect(r.spdx).toBe('BSD-3-Clause');
    // 落ちた先を deps-dev と名乗ってはならない
    expect(r.source).toBeUndefined();
  });

  it('どちらも答えなければ null', async () => {
    const r = await fetchGoLicenseWithFallback('m', 'v1', router({}));
    expect(r.spdx).toBeNull();
  });
});

describe('resolvedFrom への持ち上げ', () => {
  const dep: Dependency = { ecosystem: 'go', name: 'github.com/x/y', version: 'v1.0.0', scope: 'runtime' };

  function withGo(lookup: Awaited<ReturnType<Fetchers['go']>>): Fetchers {
    const nope = async () => ({ spdx: null });
    return { npm: nope, pypi: nope, cargo: nope, go: async () => lookup };
  }

  it('deps.dev 由来は deps-dev として出る', async () => {
    const r = await new LicenseResolver(noCache, withGo({ spdx: 'MIT', source: 'deps-dev' })).resolve(dep);
    expect(r.resolvedFrom).toBe('deps-dev');
  });

  it('source が無ければ従来どおり clearlydefined', async () => {
    const r = await new LicenseResolver(noCache, withGo({ spdx: 'MIT' })).resolve(dep);
    expect(r.resolvedFrom).toBe('clearlydefined');
  });

  it('別の版から採った事実は出典より優先して伝える', async () => {
    const r = await new LicenseResolver(
      noCache,
      withGo({ spdx: 'MIT', fromLatest: true, source: 'deps-dev' }),
    ).resolve(dep);
    expect(r.resolvedFrom).toBe('registry-latest');
  });

  it('deps-dev はキャッシュから読み戻しても出典を保つ', async () => {
    const store = new Map<string, { spdx: string | null; source: string }>();
    const cache = {
      get: async (d: Dependency) => store.get(`${d.name}@${d.version}`) ?? null,
      put: async (d: Dependency, spdx: string | null, source: string) => {
        store.set(`${d.name}@${d.version}`, { spdx, source });
      },
    };
    const resolver = new LicenseResolver(cache, withGo({ spdx: 'MIT', source: 'deps-dev' }));

    await resolver.resolve(dep);
    const second = await resolver.resolve(dep);
    expect(second.resolvedFrom).toBe('deps-dev');
  });
});
