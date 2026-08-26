import { describe, expect, it, vi } from 'vitest';
import { fetchRubygemsLicense } from '../../src/resolver/rubygems';

describe('fetchRubygemsLicense', () => {
  it('User-Agent を必ず付ける', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      const ua = (init?.headers as Record<string, string>)['user-agent'];
      expect(ua).toContain('licenseguard');
      return { ok: true, json: async () => ({ licenses: ['MIT'] }) };
    }) as unknown as typeof fetch;
    await fetchRubygemsLicense('rails', '7.1.3', f);
    expect(f).toHaveBeenCalled();
  });

  it('固定版の口から、その版そのもののライセンスを返す', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toContain('/versions/7.1.3.json');
      return { ok: true, json: async () => ({ licenses: ['MIT'] }) };
    }) as unknown as typeof fetch;
    const r = await fetchRubygemsLicense('rails', '7.1.3', f);
    expect(r.spdx).toBe('MIT');
    // 要求した版そのものが答えたので「最新で代用した」ではない
    expect(r.fromLatest).toBeUndefined();
  });

  it('版を指定しない問いに最新を答えても fromLatest は立てない', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ licenses: ['MIT'] }),
    })) as unknown as typeof fetch;
    const r = await fetchRubygemsLicense('rails', null, f);
    expect(r.spdx).toBe('MIT');
    expect(r.fromLatest).toBeUndefined();
  });

  it('固定版が取れなければ最新に落とし、その旨を示す', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('/versions/')) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ licenses: ['MIT'] }) };
    }) as unknown as typeof fetch;
    const r = await fetchRubygemsLicense('rails', '9.9.9', f);
    expect(r.spdx).toBe('MIT');
    expect(r.fromLatest).toBe(true);
  });

  /**
   * gemspec の `licenses=` は配列で、複数書ける。**配列そのものは
   * 選択（OR）か累積（AND）かを言っていない。** 分からないときに OR へ
   * 倒すと `["MIT","GPL-2.0"]` が allowed になり、義務のある側が消える。
   * AND なら過剰警告で済む——消えるより鳴るほうがいい。
   */
  it('複数ライセンスは AND で綴じる（OR に倒さない）', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ licenses: ['MIT', 'GPL-2.0'] }),
    })) as unknown as typeof fetch;
    const r = await fetchRubygemsLicense('dual', '1.0.0', f);
    expect(r.spdx).toBe('MIT AND GPL-2.0');
  });

  it('licenses が空配列や null なら null（勝手に埋めない）', async () => {
    for (const licenses of [[], null, undefined]) {
      const f = vi.fn(async () => ({
        ok: true,
        json: async () => ({ licenses }),
      })) as unknown as typeof fetch;
      expect((await fetchRubygemsLicense('x', null, f)).spdx).toBeNull();
    }
  });

  it('取得できなければ null', async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect((await fetchRubygemsLicense('nope', '1.0.0', f)).spdx).toBeNull();
  });
});
