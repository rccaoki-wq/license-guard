import { fetchNpmLicense } from './npm';
import { fetchPypiLicense } from './pypi';
import { fetchGoLicense } from './clearlydefined';
import type { Dependency, Ecosystem, ResolvedFrom } from '../types';

export interface Resolution {
  spdx: string | null;
  resolvedFrom: ResolvedFrom;
}

export interface CacheLike {
  get(dep: Dependency): Promise<{ spdx: string | null; source: string } | null>;
  put(dep: Dependency, spdx: string | null, source: string): Promise<void>;
}

export type Fetcher = (name: string, version: string | null) => Promise<string | null>;

export interface Fetchers {
  npm: Fetcher;
  pypi: Fetcher;
  go: Fetcher;
}

export const defaultFetchers: Fetchers = {
  npm: (n, v) => fetchNpmLicense(n, v),
  pypi: (n, v) => fetchPypiLicense(n, v),
  go: (n, v) => fetchGoLicense(n, v),
};

/** エコシステムごとの解決出典 */
const SOURCE: Record<Ecosystem, ResolvedFrom> = {
  npm: 'registry',
  pypi: 'registry',
  go: 'clearlydefined',
};

/** 外部 API への同時接続数の上限 */
const CONCURRENCY = 8;

export class LicenseResolver {
  constructor(
    private readonly cache: CacheLike,
    private readonly fetchers: Fetchers = defaultFetchers,
  ) {}

  async resolve(dep: Dependency): Promise<Resolution> {
    const cached = await this.cache.get(dep);
    if (cached) {
      return { spdx: cached.spdx, resolvedFrom: 'cache' };
    }

    let spdx: string | null = null;
    try {
      spdx = await this.fetchers[dep.ecosystem](dep.name, dep.version);
    } catch {
      // ネットワーク障害等はブロック要因にせず unresolved に落とす
      return { spdx: null, resolvedFrom: 'unresolved' };
    }

    if (spdx === null) {
      return { spdx: null, resolvedFrom: 'unresolved' };
    }

    const source = SOURCE[dep.ecosystem];
    await this.cache.put(dep, spdx, source);
    return { spdx, resolvedFrom: source };
  }

  async resolveAll(deps: Dependency[]): Promise<Resolution[]> {
    const out: Resolution[] = new Array(deps.length);

    for (let i = 0; i < deps.length; i += CONCURRENCY) {
      const batch = deps.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((d) => this.resolve(d)));
      results.forEach((r, j) => {
        out[i + j] = r;
      });
    }

    return out;
  }
}
