import { fetchJson, UPSTREAM_TIMEOUT_MS } from './http';

/**
 * Go モジュールプロキシは大文字を許さないため、`!` + 小文字にエスケープする。
 * 例: github.com/BurntSushi/toml -> github.com/!burnt!sushi/toml
 */
export function escapeModulePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (c) => '!' + c.toLowerCase());
}

interface LatestInfo {
  Version?: string;
}

/**
 * モジュールの最新バージョンを取得する。
 *
 * ClearlyDefined の座標にはリビジョンが必須なので、バージョン未指定の
 * 問い合わせ（パッケージページや API のデフォルト）ではこれを先に引く。
 */
export async function fetchLatestGoVersion(
  modulePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `https://proxy.golang.org/${escapeModulePath(modulePath)}/@latest`;
  const info = await fetchJson<LatestInfo>(url, fetchImpl);
  return info?.Version ?? null;
}

/**
 * セマンティックバージョンとして新しい順に並べる。
 * プレリリースは安定版より収録率が低く、代表としても不適切なので除外する。
 */
export function sortSemverDesc(versions: string[]): string[] {
  const parsed = versions
    .map((v) => {
      const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
      return m ? { v: v.trim(), n: [Number(m[1]), Number(m[2]), Number(m[3])] as const } : null;
    })
    .filter((x): x is { v: string; n: readonly [number, number, number] } => x !== null);

  parsed.sort((a, b) => b.n[0] - a.n[0] || b.n[1] - a.n[1] || b.n[2] - a.n[2]);
  return parsed.map((x) => x.v);
}

/**
 * モジュールの公開バージョン一覧を新しい順で返す。
 *
 * ClearlyDefined は最新版を harvest していないことが多いため、
 * 収録済みの版を探す候補として使う。
 */
export async function fetchGoVersions(
  modulePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `https://proxy.golang.org/${escapeModulePath(modulePath)}/@v/list`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) return [];
    return sortSemverDesc((await res.text()).split('\n'));
  } catch {
    return [];
  }
}
