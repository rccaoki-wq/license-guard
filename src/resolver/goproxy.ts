import { fetchJson } from './http';

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
