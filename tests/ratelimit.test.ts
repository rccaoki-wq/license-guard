import { describe, expect, it, vi } from 'vitest';
import { enforceRateLimit, rateLimitKey } from '../src/ratelimit';

const req = (headers: Record<string, string> = {}) =>
  new Request('https://x/api/scan', { method: 'POST', headers });

describe('rateLimitKey', () => {
  it('cf-connecting-ip を優先する', () => {
    expect(rateLimitKey(req({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
  });

  it('x-forwarded-for の先頭を使う', () => {
    expect(rateLimitKey(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('取れなければ unknown', () => {
    expect(rateLimitKey(req())).toBe('unknown');
  });

  it('鍵の長さを刈る', () => {
    expect(rateLimitKey(req({ 'cf-connecting-ip': 'x'.repeat(200) })).length).toBe(64);
  });
});

describe('enforceRateLimit', () => {
  it('バインディングが無ければ素通しする', async () => {
    // レート制限は保護であって機能ではない。不在で壊れてはいけない
    expect(await enforceRateLimit(undefined, req())).toBeNull();
  });

  it('上限内なら null', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    expect(await enforceRateLimit(limiter, req())).toBeNull();
  });

  it('超過したら 429 と retry-after を返す', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const res = await enforceRateLimit(limiter, req());
    expect(res?.status).toBe(429);
    expect(res?.headers.get('retry-after')).toBe('60');
    expect(((await res!.json()) as { error: string }).error).toContain('Rate limit exceeded');
  });

  it('判定自体が失敗したら通す（正当な利用を止めない）', async () => {
    const limiter = {
      limit: vi.fn(async () => {
        throw new Error('limiter unavailable');
      }),
    };
    expect(await enforceRateLimit(limiter, req())).toBeNull();
  });

  it('クライアントごとに鍵を分ける', async () => {
    const seen: string[] = [];
    const limiter = { limit: vi.fn(async (o: { key: string }) => { seen.push(o.key); return { success: true }; }) };
    await enforceRateLimit(limiter, req({ 'cf-connecting-ip': '1.1.1.1' }));
    await enforceRateLimit(limiter, req({ 'cf-connecting-ip': '2.2.2.2' }));
    expect(seen).toEqual(['1.1.1.1', '2.2.2.2']);
  });
});
