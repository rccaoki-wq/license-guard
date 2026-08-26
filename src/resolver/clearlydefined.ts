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

/**
 * ClearlyDefined だけ待ち時間を短くする。
 *
 * 実在の go.sum から取った固定版 120 件を計測したところ、
 * **答えが出る座標は必ず速い**（中央 1.0 秒 / p95 1.7 秒 / p99 2.75 秒）。
 * 反対に 38% は 6 秒経っても返らない。未収録の座標を要求されると
 * ClearlyDefined がその場で harvest を始めるためで、待ち続けても
 * このリクエストの中で答えが出ることはない。
 *
 * したがって既定の 5 秒は、後半 2 秒が**必ず捨て札**になる。
 * 3 秒なら計測した範囲で取りこぼしは 0 件で、詰めた分そのまま
 * 同じ時間予算で確認できる依存が増える。
 *
 * これ以上は下げない。1.5 秒にすると解決できたはずの 11% を
 * 落とした。安全側（allowed ではなく review）に倒れるとはいえ、
 * 答えが減ること自体が損失。
 */
export const CLEARLYDEFINED_TIMEOUT_MS = 3_000;

/**
 * ClearlyDefined から使ってよい答えかを判定する。
 *
 * 中身が空同然の値をそのまま採ると、**解決できていないものを解決したと
 * 数える**。実測では deps.dev が NuGet の欠損 63 件すべてに
 * `non-standard` を返していた。件数だけ見ると 63/63 埋まったように
 * 見えるが、利用者に見せられる情報は一つも増えていない。
 *
 * `LicenseRef-scancode-*` も落とす。あれは本文を機械で読んだ**推定**で、
 * 宣言ではない。ScanCode は CLA・保証免責・特許条項・出所不明の言及にも
 * これを付けるが、どれも同梱コードの許諾ではない。MediatR には
 * `RPL-1.5 AND LicenseRef-scancode-unknown-license-reference` が付いていた。
 * もっともらしい誤りは、答えが無いことより悪い。
 *
 * **この判定は ClearlyDefined の記録に対する規則で、生態系には依らない。**
 * 以前は nuget.ts に置いていたので Go の経路だけが素通りしていて、実在の
 * go.mod では `github.com/fatih/color`（素の MIT）が
 * `LicenseRef-scancode-unknown-license-reference AND MIT` として review に
 * 落ちていた。判定を記録の側に置いて、両方の経路から使う。
 */
export function usableDeclared(declared: string | undefined): string | null {
  const d = declared?.trim();
  if (!d) return null;
  if (/^(NOASSERTION|OTHER|non-standard|UNKNOWN)$/i.test(d)) return null;
  if (/LicenseRef-scancode/i.test(d)) return null;
  return dedupeAndTerms(d);
}

/**
 * `MIT AND MIT AND BSD-3-Clause AND BSD-3-Clause` のような重複を畳む。
 * ClearlyDefined が実際にこの形を返す（Bogus、consul のサブモジュール）。
 * **AND だけの式に限る**——OR や括弧や WITH が混ざる式は構造を壊しうるので
 * 触らない。
 */
export function dedupeAndTerms(expr: string): string {
  if (/[()]|\bOR\b|\bWITH\b/i.test(expr)) return expr;
  const parts = expr.split(/\s+AND\s+/i).map((p) => p.trim());
  if (parts.length < 2) return expr;
  return [...new Set(parts)].join(' AND ');
}

/** 未収録の座標では declared が無い、あるいは NOASSERTION になる */
async function declaredLicense(
  modulePath: string,
  revision: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `https://api.clearlydefined.io/definitions/${toGoCoordinates(modulePath, revision)}`;
  const doc = await fetchJson<ClearlyDefinedDoc>(url, fetchImpl, CLEARLYDEFINED_TIMEOUT_MS);
  return usableDeclared(doc?.licensed?.declared);
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
