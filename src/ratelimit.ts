/**
 * 無認証の公開エンドポイントに対するレート制限。
 *
 * 依存数上限・本文上限・上流タイムアウトで 1 リクエストあたりの被害は
 * 既に限定されているが、連続的な濫用までは防げない。
 *
 * Cloudflare のレート制限バインディングはロケーション単位のカウントで、
 * 「permissive, eventually consistent」と明示されている。カウンタは
 * マシン上にキャッシュされ非同期に更新されるため、実効値は設定値より
 * 緩くなる。実測では上限 20/60s に対して 39 回目で拒否された。
 *
 * したがってこれは厳密な割当ではなく、持続的な濫用に対する防御である。
 * 瞬間的なバーストは通り抜けるので、1 リクエストあたりの被害を
 * 依存数上限・本文上限・上流タイムアウトで抑える設計と併用すること。
 *
 * バインディングが無い環境（テスト、ローカル）では素通りさせる。
 * レート制限は保護であって機能ではないので、不在で壊れてはいけない。
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** クライアントを識別する鍵。IP は共有されうるので最後の手段として使う */
export function rateLimitKey(request: Request): string {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return ip.slice(0, 64);
}

/**
 * 制限を超えていれば 429 を返す。超えていなければ null。
 * 超過の判定自体が失敗した場合は通す（誤って正当な利用を止めない）。
 */
export async function enforceRateLimit(
  limiter: RateLimitBinding | undefined,
  request: Request,
  retryAfterSeconds = 60,
): Promise<Response | null> {
  if (!limiter) return null;

  let allowed = true;
  try {
    allowed = (await limiter.limit({ key: rateLimitKey(request) })).success;
  } catch {
    return null;
  }

  if (allowed) return null;

  return Response.json(
    {
      error: 'Rate limit exceeded. This is a free, unauthenticated service; please slow down.',
      retryAfter: retryAfterSeconds,
    },
    { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } },
  );
}
