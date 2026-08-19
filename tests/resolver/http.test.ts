import { describe, expect, it, vi } from 'vitest';
import { fetchJson, UPSTREAM_TIMEOUT_MS } from '../../src/resolver/http';

describe('fetchJson', () => {
  it('200 ならパース済みボディを返す', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ a: 1 }) })) as unknown as typeof fetch;
    expect(await fetchJson<{ a: number }>('https://x', f)).toEqual({ a: 1 });
  });

  it('HTTP エラーなら null を返す', async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await fetchJson('https://x', f)).toBeNull();
  });

  it('fetch が例外を投げても null を返す', async () => {
    const f = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await fetchJson('https://x', f)).toBeNull();
  });

  it('JSON パース失敗でも null を返す', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('invalid json');
      },
    })) as unknown as typeof fetch;
    expect(await fetchJson('https://x', f)).toBeNull();
  });

  it('タイムアウト用の AbortSignal を渡す', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await fetchJson('https://x', f);
    expect(f).toHaveBeenCalledOnce();
  });

  it('タイムアウトは上流の遅延で Worker を止めない長さに設定されている', () => {
    expect(UPSTREAM_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(UPSTREAM_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
