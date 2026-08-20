import { fetchJson } from './http';
import { fetchGoVersions, fetchLatestGoVersion } from './goproxy';
import type { LicenseLookup } from './index';

/**
 * Go モジュールパスを ClearlyDefined の座標 (type/provider/namespace/name/revision)
 * に変換する。namespace 内のスラッシュはエンコードが必要。
 */
export function toGoCoordinates(modulePath: string, version: string): string {
  const parts = modulePath.split('/');
  const name = parts.pop() ?? modulePath;
  const namespace = parts.length > 0 ? encodeURIComponent(parts.join('/')) : '-';
  return `go/golang/${namespace}/${name}/${version}`;
}

interface ClearlyDefinedDoc {
  licensed?: { declared?: string };
}

/** 未収録の座標では declared が無い、あるいは NOASSERTION になる */
async function declaredLicense(
  modulePath: string,
  revision: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `https://api.clearlydefined.io/definitions/${toGoCoordinates(modulePath, revision)}`;
  const doc = await fetchJson<ClearlyDefinedDoc>(url, fetchImpl);
  const declared = doc?.licensed?.declared?.trim();
  if (!declared || declared === 'NOASSERTION') return null;
  return declared;
}

/** 最新版が未収録だったときに試す旧版の数 */
const FALLBACK_CANDIDATES = 6;

/**
 * 候補をバージョン範囲全体から選ぶ。
 *
 * 直近の数版だけを見ても足りない。golang.org/x/crypto は 55 版あり
 * 収録済みなのは v0.21.0 のような古い版で、上位数件では届かない。
 * 新しい版を優先しつつ、古い側からも等間隔で拾う。
 */
export function pickCandidates(sortedDesc: string[], count: number): string[] {
  if (sortedDesc.length <= count) return sortedDesc;

  const recent = sortedDesc.slice(0, Math.ceil(count / 2));
  const rest = sortedDesc.slice(recent.length);
  const need = count - recent.length;
  const step = Math.max(1, Math.floor(rest.length / need));

  const spread: string[] = [];
  for (let i = 0; i < rest.length && spread.length < need; i += step) {
    spread.push(rest[i]!);
  }
  return [...recent, ...spread];
}

/**
 * ClearlyDefined から Go モジュールのライセンスを取得する。
 *
 * Go には中央のライセンスメタデータが無いため、キュレーション済みの
 * ClearlyDefined に頼る。ただし ClearlyDefined は最新版を harvest して
 * いないことが多く（testify は v1.12.1 が未収録で v1.10.0 は収録済）、
 * 最新版だけを見ると主要モジュールでも解決に失敗する。
 *
 * そこでバージョン未指定の場合に限り、収録済みの旧版まで遡って探す。
 * 固定版を指定された場合は代用しない。「この版のライセンスは何か」に
 * 別の版の答えを返すことは、たとえ多くの場合正しくても許されない。
 *
 * 候補は並列で問い合わせる。直列にすると 5 秒のタイムアウトが積み上がり
 * Worker の実行時間を使い切るため。
 */
export async function fetchGoLicense(
  modulePath: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  if (version !== null) {
    const spdx = await declaredLicense(modulePath, version, fetchImpl);
    if (spdx !== null) return { spdx };
    // 固定版が未収録でも諦めない。npm / PyPI と同じく別の版から採り、
    // 「要求した版そのものではない」ことを fromLatest で必ず伝える。
    // go.sum のように固定版が並ぶ入力では、ここが無いと大半が未解決になる。
    const fallback = await anyHarvestedVersion(modulePath, version, fetchImpl);
    return fallback === null ? { spdx: null } : { spdx: fallback, fromLatest: true };
  }

  const latest = await fetchLatestGoVersion(modulePath, fetchImpl);
  if (latest !== null) {
    const spdx = await declaredLicense(modulePath, latest, fetchImpl);
    if (spdx !== null) return { spdx };
  }

  const found = await anyHarvestedVersion(modulePath, latest, fetchImpl);
  if (found === null) return { spdx: null };

  // 要求された対象そのものではない版から採ったことを呼び出し側へ伝える
  return { spdx: found, fromLatest: true };
}

/** 収録済みの版を範囲全体から探す。exclude は既に試した版 */
async function anyHarvestedVersion(
  modulePath: string,
  exclude: string | null,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const versions = await fetchGoVersions(modulePath, fetchImpl);
  const candidates = pickCandidates(
    versions.filter((v) => v !== exclude),
    FALLBACK_CANDIDATES,
  );
  if (candidates.length === 0) return null;

  const results = await Promise.all(
    candidates.map((v) => declaredLicense(modulePath, v, fetchImpl).catch(() => null)),
  );
  // 新しい順に並んでいるので、最初に見つかったものが最も新しい収録済みの版
  return results.find((r) => r !== null) ?? null;
}
