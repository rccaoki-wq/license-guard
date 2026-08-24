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
