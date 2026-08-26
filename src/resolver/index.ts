import { fetchNpmLicense } from './npm';
import { fetchPypiLicense } from './pypi';
import { fetchGoLicenseWithFallback } from './go';
import { fetchCratesLicense } from './crates';
import { fetchRubygemsLicense } from './rubygems';
import { fetchNugetLicense } from './nuget';
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
  /**
   * 既定の出典（SOURCE）と違う相手が答えた場合に、その相手を伝える。
   * 「どこから読んだか」は「何が言えるか」とは別の事実で、
   * 経路を統合した都合で表示だけ既定値のまま残すと、静かに嘘になる。
   */
  source?: ResolvedFrom;
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
  rubygems: Fetcher;
  nuget: Fetcher;
}

export const defaultFetchers: Fetchers = {
  npm: (n, v) => fetchNpmLicense(n, v),
  pypi: (n, v) => fetchPypiLicense(n, v),
  go: (n, v) => fetchGoLicenseWithFallback(n, v),
  cargo: (n, v) => fetchCratesLicense(n, v),
  rubygems: (n, v) => fetchRubygemsLicense(n, v),
  nuget: (n, v) => fetchNugetLicense(n, v),
};

/** エコシステムごとの解決出典（固定版から採れた場合） */
const SOURCE: Record<Ecosystem, ResolvedFrom> = {
  npm: 'registry',
  pypi: 'registry',
  go: 'clearlydefined',
  cargo: 'registry',
  rubygems: 'registry',
  nuget: 'registry',
};

/**
 * 期限までに終わらなければ「未確認」として返す。**中身は捨てない**
 * ——遅れて届いた解決はキャッシュに入るので、次のスキャンが速くなる。
 */
function withCutoff(p: Promise<Resolution>, ms: number): Promise<Resolution> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ spdx: null, resolvedFrom: 'not-checked' }), ms);
    p.then(
      (r) => {
        clearTimeout(t);
        resolve(r);
      },
      () => {
        clearTimeout(t);
        resolve({ spdx: null, resolvedFrom: 'unresolved' });
      },
    );
  });
}

const RESOLVED_FROM_VALUES: readonly ResolvedFrom[] = [
  'lockfile',
  'registry',
  'registry-latest',
  'deps-dev',
  'clearlydefined',
  'repo-license',
  'license-file',
  'unresolved',
];

/**
 * 外部 API への同時接続数の上限。
 *
 * 律速は帯域ではなく**上流の応答時間**。実測で ClearlyDefined が 1〜2 秒、
 * proxy.golang.org が 0.6〜1.7 秒あり、Go は両方を順に踏むので 1 件 ≈ 3 秒。
 * 8 並列だと 20 秒の予算で 50 件ほどしか終わらず、実物の go.sum（299 件）は
 * 大半が未確認のまま返っていた。待ち時間が支配的なので、並列数を上げた分
 * ほぼそのまま件数が伸びる。
 *
 * 上げすぎない理由は 2 つ。ClearlyDefined は公共の無償 API であること、
 * Worker には 1 リクエストあたりのサブリクエスト上限があり、
 * MAX_LOOKUPS(200) × 1 件あたり 2〜3 回で既に余裕が大きくないこと。
 */
const CONCURRENCY = 16;

export class LicenseResolver {
  constructor(
    private readonly cache: CacheLike,
    private readonly fetchers: Fetchers = defaultFetchers,
  ) {}

  async resolve(
    dep: Dependency,
    /**
     * 呼び出し側が既に一括で引いた結果。渡された場合は 1 件ずつの
     * 往復を**しない**。scan は費用の見積もりのために必ず getMany を
     * 撃っており、その結果を捨てて引き直すと、既知の依存がそのまま
     * 往復に化ける。大きなロックファイルでは大半が既知なので、
     * ここが実時間を支配する。
     */
    prefetched?: Map<string, { spdx: string | null; source: string }>,
  ): Promise<Resolution> {
    // ロックファイルに記録された値は、実際に導入される版そのものの情報。
    // 上流に問い合わせる理由が無く、レジストリより確かでもある。
    if (dep.declaredLicense) {
      return { spdx: dep.declaredLicense, resolvedFrom: 'lockfile' };
    }

    // キャッシュは最適化であり、その失敗が解決処理を壊してはならない。
    // D1 のクォータ枯渇などで読み書きが落ちても、レジストリ照会は続行する。
    const cached =
      prefetched === undefined
        ? await this.cache.get(dep).catch(() => null)
        : (prefetched.get(`${dep.ecosystem}|${dep.name}|${dep.version}`) ?? null);

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
      // 答えが無いことにも種類がある。**なぜ無いかを知っている場合は
      // それを潰さない。** `unresolved` の文言は「どこにも宣言が無いか、
      // 上流が返さなかった」で、ライセンス本文を同梱している
      // パッケージ（NuGet の `<license type="file">`）に当てると嘘になる
      // ——宣言はある。読めない形で置いてあるだけ。
      //
      // 引けなかった事実は保存しない。無い答えを溜めても次が速くならず、
      // 内部パッケージ名を書き込む経路を増やすだけになる
      return { spdx: null, resolvedFrom: lookup.source ?? 'unresolved' };
    }

    // fromLatest が最優先。「要求した版そのものではない」は、どの API が
    // 答えたかより利用者の判断を変えるため、こちらを潰してはならない。
    const source: ResolvedFrom = lookup.fromLatest
      ? 'registry-latest'
      : (lookup.source ?? SOURCE[dep.ecosystem]);
    await this.cache.put(dep, lookup.spdx, source).catch(() => undefined);
    return { spdx: lookup.spdx, resolvedFrom: source };
  }

  /**
   * `deadline`（epoch ミリ秒）を過ぎたら、残りは照会せず未確認として返す。
   *
   * 件数の上限（MAX_LOOKUPS）は費用は抑えるが**時間は抑えない**。
   * 同時 CONCURRENCY 件の直列バッチなので、上流が遅い日は
   * 「1件あたりの上限 × バッチ数」まで伸びる。実際、実物の go.sum で
   * 3 分待っても応答が返らなかった。**応答しないのが最悪の結果**で、
   * 一部未確認は既に正しく表示できる（NOT_CHECKED_RESULT）。
   */
  async resolveAll(
    deps: Dependency[],
    deadline?: number,
    prefetched?: Map<string, { spdx: string | null; source: string }>,
  ): Promise<Resolution[]> {
    const out: Resolution[] = new Array(deps.length);

    // 固定幅バッチではなく滑走窓にする。固定幅だと 1 バッチはその中で
    // **最も遅い 1 件**の速さになり、上流の応答時間は裾が長いので
    // 中央値ではなく毎バッチの最大値が積み上がる。実測で crates.io の
    // 200 件が 18 秒（≒ 12.5 バッチ × 1.4 秒）かかっていたのはこれで、
    // 20 秒の予算をほぼ使い切っていた。空いた枠に次を流し込めば、
    // 遅い件どうしが重なって待ち時間を共有する。
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= deps.length) return;

        const left = deadline === undefined ? Infinity : deadline - Date.now();
        if (left <= 0) {
          // 締切を過ぎたら、残りは自分も他の worker も照会しない
          next = deps.length;
          out[i] = { spdx: null, resolvedFrom: 'not-checked' };
          return;
        }

        // 締切の直前に始まった 1 件が丸ごと走り切ると「締切 + 上流
        // タイムアウト」まで伸びる。詰まるのはまさにその 1 件なので、
        // 残り時間そのもので打ち切らないと予算の保証にならない。
        const p = this.resolve(deps[i]!, prefetched);
        out[i] = left === Infinity ? await p : await withCutoff(p, left);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, deps.length) }, () => worker()),
    );

    // 締切で worker が抜けた後ろは、誰も書いていない
    for (let i = 0; i < deps.length; i++) {
      out[i] ??= { spdx: null, resolvedFrom: 'not-checked' };
    }

    return out;
  }
}
