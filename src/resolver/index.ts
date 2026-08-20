import { fetchNpmLicense } from './npm';
import { fetchPypiLicense } from './pypi';
import { fetchGoLicense } from './clearlydefined';
import { fetchCratesLicense } from './crates';
import type { Dependency, Ecosystem, ResolvedFrom } from '../types';

export interface Resolution {
  spdx: string | null;
  resolvedFrom: ResolvedFrom;
}

/**
 * 各レジストリ実装が返す形。
 * fromLatest は、固定されたバージョン自身から採れず最新リリースに
 * 落ちたことを示す。呼び出し側はこれを結果に明示する義務がある。
 */
export interface LicenseLookup {
  spdx: string | null;
  fromLatest?: boolean;
}

export interface CacheLike {
  get(dep: Dependency): Promise<{ spdx: string | null; source: string } | null>;
  put(dep: Dependency, spdx: string | null, source: string): Promise<void>;
  /** 任意。上流照会が必要な件数を事前に見積もるために使う */
  getMany?(deps: Dependency[]): Promise<Map<string, { spdx: string | null; source: string }>>;
}

export type Fetcher = (name: string, version: string | null) => Promise<LicenseLookup>;

export interface Fetchers {
  npm: Fetcher;
  pypi: Fetcher;
  go: Fetcher;
  cargo: Fetcher;
}

export const defaultFetchers: Fetchers = {
  npm: (n, v) => fetchNpmLicense(n, v),
  pypi: (n, v) => fetchPypiLicense(n, v),
  go: (n, v) => fetchGoLicense(n, v),
  cargo: (n, v) => fetchCratesLicense(n, v),
};

/** エコシステムごとの解決出典（固定版から採れた場合） */
const SOURCE: Record<Ecosystem, ResolvedFrom> = {
  npm: 'registry',
  pypi: 'registry',
  go: 'clearlydefined',
  cargo: 'registry',
};

const RESOLVED_FROM_VALUES: readonly ResolvedFrom[] = [
  'lockfile',
  'registry',
  'registry-latest',
  'clearlydefined',
  'unresolved',
];

/** 外部 API への同時接続数の上限 */
const CONCURRENCY = 8;

export class LicenseResolver {
  constructor(
    private readonly cache: CacheLike,
    private readonly fetchers: Fetchers = defaultFetchers,
  ) {}

  async resolve(dep: Dependency): Promise<Resolution> {
    // ロックファイルに記録された値は、実際に導入される版そのものの情報。
    // 上流に問い合わせる理由が無く、レジストリより確かでもある。
    if (dep.declaredLicense) {
      return { spdx: dep.declaredLicense, resolvedFrom: 'lockfile' };
    }

    // キャッシュは最適化であり、その失敗が解決処理を壊してはならない。
    // D1 のクォータ枯渇などで読み書きが落ちても、レジストリ照会は続行する。
    const cached = await this.cache.get(dep).catch(() => null);

    // キャッシュヒットでも出所は保つ。「固定版由来」か「最新版由来」かは
    // 利用者の判断を変えるため、キャッシュを経ただけで失ってはならない。
    if (cached) {
      const from = RESOLVED_FROM_VALUES.includes(cached.source as ResolvedFrom)
        ? (cached.source as ResolvedFrom)
        : SOURCE[dep.ecosystem];
      return { spdx: cached.spdx, resolvedFrom: from };
    }

    let lookup: LicenseLookup;
    try {
      lookup = await this.fetchers[dep.ecosystem](dep.name, dep.version);
    } catch {
      // ネットワーク障害等はブロック要因にせず unresolved に落とす
      return { spdx: null, resolvedFrom: 'unresolved' };
    }

    if (lookup.spdx === null) {
      return { spdx: null, resolvedFrom: 'unresolved' };
    }

    const source: ResolvedFrom = lookup.fromLatest ? 'registry-latest' : SOURCE[dep.ecosystem];
    await this.cache.put(dep, lookup.spdx, source).catch(() => undefined);
    return { spdx: lookup.spdx, resolvedFrom: source };
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
