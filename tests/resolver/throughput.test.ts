import { describe, expect, it, vi } from 'vitest';
import { LicenseResolver } from '../../src/resolver';
import type { Dependency } from '../../src/types';

const dep = (name: string, over: Partial<Dependency> = {}): Dependency => ({
  ecosystem: 'npm',
  name,
  version: '1.0.0',
  scope: 'runtime',
  ...over,
});

const key = (d: Dependency) => `${d.ecosystem}|${d.name}|${d.version}`;

/** get の呼び出し回数を数えるキャッシュ。往復そのものを観測する */
function countingCache(seed: Record<string, string> = {}) {
  const store = new Map<string, { spdx: string | null; source: string }>();
  for (const [k, v] of Object.entries(seed)) store.set(k, { spdx: v, source: 'registry' });
  const calls = { get: 0, put: 0, getMany: 0 };
  return {
    calls,
    async get(d: Dependency) {
      calls.get += 1;
      return store.get(key(d)) ?? null;
    },
    async put(d: Dependency, spdx: string | null, source: string) {
      calls.put += 1;
      store.set(key(d), { spdx, source });
    },
    async getMany(deps: Dependency[]) {
      calls.getMany += 1;
      const found = new Map<string, { spdx: string | null; source: string }>();
      for (const d of deps) {
        const hit = store.get(key(d));
        if (hit) found.set(key(d), hit);
      }
      return found;
    },
  };
}

describe('resolveAll のスループット', () => {
  it('先に引いたキャッシュを渡せば、1件ずつの往復をしない', async () => {
    // 実運用で支配的なのはこの形。大きなロックファイルの大半は既知で、
    // scan は先に getMany を撃っている。その結果を捨てて resolve() が
    // 1件ずつ D1 を引き直すと、ヒットしている分がまるごと往復になる。
    const deps = Array.from({ length: 50 }, (_, i) => dep(`pkg-${i}`));
    const seed = Object.fromEntries(deps.map((d) => [key(d), 'MIT']));
    const cache = countingCache(seed);
    const npm = vi.fn();
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const prefetched = await cache.getMany(deps);
    cache.calls.get = 0;

    const out = await r.resolveAll(deps, undefined, prefetched);

    expect(out.every((o) => o.spdx === 'MIT')).toBe(true);
    expect(npm).not.toHaveBeenCalled();
    // 渡した以上、1件も引き直さない
    expect(cache.calls.get).toBe(0);
  });

  it('渡されたキャッシュに無いものは従来どおり上流へ行く', async () => {
    const deps = [dep('known'), dep('unknown')];
    const cache = countingCache({ [key(deps[0]!)]: 'MIT' });
    const npm = vi.fn(async () => ({ spdx: 'Apache-2.0' }));
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const prefetched = await cache.getMany(deps);
    const out = await r.resolveAll(deps, undefined, prefetched);

    expect(out[0]!.spdx).toBe('MIT');
    expect(out[1]!.spdx).toBe('Apache-2.0');
    expect(npm).toHaveBeenCalledTimes(1);
  });

  it('遅い1件が、後続の速い依存を巻き込んで待たせない', async () => {
    // 固定幅バッチだと、バッチはその中で最も遅い1件の速さになる。
    // 上流の応答時間は裾が長いので、これが実時間を支配する。
    const SLOW = 200;
    const deps = Array.from({ length: 64 }, (_, i) => dep(`pkg-${i}`));
    const cache = countingCache();
    // 16件ごとの先頭だけ遅い = 固定幅バッチなら全バッチが遅い方に律速される
    const npm = vi.fn(async (name: string) => {
      const i = Number(name.split('-')[1]);
      if (i % 16 === 0) await new Promise((r) => setTimeout(r, SLOW));
      return { spdx: 'MIT' };
    });
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const t0 = Date.now();
    const out = await r.resolveAll(deps);
    const ms = Date.now() - t0;

    expect(out).toHaveLength(64);
    expect(out.every((o) => o.spdx === 'MIT')).toBe(true);
    // 固定幅バッチ(16並列×4バッチ、各バッチに遅い1件) => 約 4×SLOW。
    // 空いた枠に次を流し込めば、遅い4件は互いに重なるので約 1×SLOW で済む。
    expect(ms).toBeLessThan(SLOW * 2.5);
  });

  it('締切を過ぎた分は not-checked のまま、順序も保つ', async () => {
    const deps = Array.from({ length: 40 }, (_, i) => dep(`pkg-${i}`));
    const cache = countingCache();
    const npm = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return { spdx: 'MIT' };
    });
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn(), cargo: vi.fn(), rubygems: vi.fn(), nuget: vi.fn() });

    const out = await r.resolveAll(deps, Date.now() + 100);

    expect(out).toHaveLength(40);
    expect(out.some((o) => o.resolvedFrom === 'not-checked')).toBe(true);
    // 打ち切られたものが allowed 相当に化けないこと
    for (const o of out) {
      if (o.resolvedFrom === 'not-checked') expect(o.spdx).toBeNull();
    }
  });
});
