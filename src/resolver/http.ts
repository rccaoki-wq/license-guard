/**
 * 上流レジストリへのタイムアウト。
 *
 * ClearlyDefined は未ハーベストの座標を初めて要求された際、その場で
 * ハーベストを行うため応答が数分に及ぶことがある。タイムアウトを設けないと
 * Worker のリクエスト時間を使い切ってスキャン全体が失敗する。
 * 上流の遅延は「解決できなかった」として扱い、判定をブロックしない。
 */
export const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * 上流 API から JSON を取得する。
 * ネットワーク障害・HTTP エラー・タイムアウト・パース失敗はすべて null に落とす。
 *
 * `timeoutMs` は上流ごとの事情に合わせて縮めるためのもの。既定値を
 * 全体に押し付けると、遅いのが当たり前の相手に合わせて速い相手まで待つ。
 */
/**
 * 上流からテキストの先頭部分だけを取得する。
 *
 * 目的の情報がファイルの先頭にあると分かっている場合に使う。
 * PEP 658 の core metadata がこれで、必要なヘッダは先頭にあるが、
 * ファイル本体には README がまるごと入っていて数十 KB になる。
 * Range を使えば、相手にも自分にも無駄な転送をさせない。
 *
 * 相手が Range を無視して全体を返すことがある（206 ではなく 200）。
 * その場合も呼び出し側は先頭しか読まないので、正しさには影響しない。
 */
export async function fetchTextHead(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { Range: `bytes=0-${maxBytes - 1}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, maxBytes);
  } catch {
    return null;
  }
}

export async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<T | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
