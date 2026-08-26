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
    return {
      npm: nope,
      pypi: nope,
      cargo: nope,
      rubygems: nope,
      nuget: nope,
      go: async () => lookup,
    };
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

/**
 * **版を指定しない問いで、deps.dev に一度も聞いていなかった。**
 *
 * 実測: 実在の go.sum から取った 300 モジュールのうち 26 件が
 * 「ライセンス不明」で返っていた。ほぼ全部がリポジトリ内のサブモジュール
 * （`aws-sdk-go-v2/service/sts`, `azure-sdk-for-go/sdk/...`,
 * `go-redis/extra/rediscmd/v9` 等）で、**deps.dev はどれも答えを持っていた。**
 *
 * 経路はこうなっていた:
 *   1. repo-license …… サブモジュールは意図的に断る（consul は BUSL、
 *      consul/sdk は MPL で、親の LICENSE に支配されないため。これは正しい）
 *   2. deps.dev …… `version === null` で即 null（版が無いと引けないから）
 *   3. ClearlyDefined …… 収録率 38%。サブモジュールはほぼ収録されていない
 *
 * つまり**最も当たる相手だけが、最もよく使われる経路から外れていた。**
 * 版が無くても proxy.golang.org に `@latest` を聞けば版は確定する。
 * 推測ではなく一次情報なので、ClearlyDefined の「収録済みの版から探す」
 * より直接的に答えている。
 */
describe('版を指定しない問い', () => {
  /** 相手先ごとに応答を切り替える偽 fetch（proxy.golang.org を含む） */
  function router3(routes: {
    proxy?: string | null;
    versions?: string[] | null;
    depsdev?: unknown;
    clearlydefined?: unknown;
    raw?: string | null;
  }) {
    return vi.fn(async (url: string) => {
      if (url.includes('raw.githubusercontent.com')) {
        return routes.raw == null
          ? { ok: false, text: async () => '' }
          : { ok: true, text: async () => routes.raw as string };
      }
      // proxy.golang.org は 2 つの経路で使われる。`@latest` は JSON、
      // `@v/list` は改行区切りのテキスト。片方だけ模しても、もう片方が
      // 静かに空を返して**別の層の欠陥に見える**
      if (url.includes('proxy.golang.org')) {
        if (url.endsWith('/@latest')) {
          return routes.proxy == null
            ? { ok: false, json: async () => ({}) }
            : { ok: true, json: async () => ({ Version: routes.proxy }) };
        }
        return routes.versions == null
          ? { ok: false, text: async () => '' }
          : { ok: true, text: async () => (routes.versions as string[]).join('\n') };
      }
      const body = url.includes('deps.dev') ? routes.depsdev : routes.clearlydefined;
      if (body == null) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => body };
    }) as unknown as typeof fetch;
  }

  it('サブモジュールでも @latest を確定させて deps.dev に聞く', async () => {
    const f = router3({ proxy: 'v1.45.7', depsdev: { licenses: ['Apache-2.0'] } });
    const r = await fetchGoLicenseWithFallback('github.com/aws/aws-sdk-go-v2/service/sts', null, f);

    expect(r.spdx).toBe('Apache-2.0');
    expect(r.source).toBe('deps-dev');
  });

  it('確定した版で聞く（版を推測しない）', async () => {
    const f = router3({ proxy: 'v9.22.0', depsdev: { licenses: ['BSD-2-Clause'] } });
    await fetchGoLicenseWithFallback('github.com/redis/go-redis/extra/rediscmd/v9', null, f);

    const urls = (f as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('deps.dev') && u.includes('v9.22.0'))).toBe(true);
  });

  it('版を指定していないので fromLatest は立てない', async () => {
    // npm / crates / pypi と同じ約束。「最新を答える」のは版を指定しない
    // 問いの**正しい答え**であって、要求した版から落ちたわけではない
    const f = router3({ proxy: 'v1.0.0', depsdev: { licenses: ['MIT'] } });
    const r = await fetchGoLicenseWithFallback('github.com/x/y/sub', null, f);
    expect(r.fromLatest).toBeUndefined();
  });

  it('リポジトリの LICENSE が読めたら、そちらが勝つ（再ライセンスに追随する）', async () => {
    // Vault は 2023 年に MPL-2.0 から BUSL-1.1 へ移った。収録済みの
    // スキャン結果は古いままなので、一次資料の LICENSE を先に読む順序は変えない
    const f = router3({
      raw: 'Business Source License 1.1',
      proxy: 'v1.20.0',
      depsdev: { licenses: ['MPL-2.0'] },
    });
    const r = await fetchGoLicenseWithFallback('github.com/hashicorp/vault', null, f);

    expect(r.spdx).toBe('BUSL-1.1');
    expect(r.source).toBe('repo-license');
  });

  it('deps.dev が答えなければ従来どおり ClearlyDefined に落ちる', async () => {
    const f = router3({
      proxy: 'v1.0.0',
      versions: ['v1.0.0'],
      clearlydefined: { licensed: { declared: 'ISC' } },
    });
    const r = await fetchGoLicenseWithFallback('github.com/x/y/sub', null, f);
    expect(r.spdx).toBe('ISC');
  });

  it('@latest が取れなくても、既存の経路を塞がない', async () => {
    // 追加した一段が失敗しただけで、今まで答えられていたものを
    // 落としてはいけない。ClearlyDefined は @v/list から自前で版を探す
    const f = router3({
      proxy: null,
      versions: ['v1.0.0'],
      clearlydefined: { licensed: { declared: 'MIT' } },
    });
    const r = await fetchGoLicenseWithFallback('github.com/x/y/sub', null, f);
    expect(r.spdx).toBe('MIT');
  });
});
