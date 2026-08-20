import { describe, expect, it, vi } from 'vitest';
import { fetchCratesLicense } from '../../src/resolver/crates';

describe('fetchCratesLicense', () => {
  it('User-Agent を必ず付ける（無いと crates.io に拒否される）', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      const ua = (init?.headers as Record<string, string>)['user-agent'];
      expect(ua).toContain('licenseguard');
      return { ok: true, json: async () => ({ version: { license: 'MIT' } }) };
    }) as unknown as typeof fetch;
    await fetchCratesLicense('serde', '1.0.210', f);
    expect(f).toHaveBeenCalled();
  });

  it('指定バージョンの SPDX 式を返す', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: { license: 'MIT OR Apache-2.0' } }),
    })) as unknown as typeof fetch;
    expect((await fetchCratesLicense('serde', '1.0.210', f)).spdx).toBe('MIT OR Apache-2.0');
  });

  it('バージョン未指定なら安定版を使う', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        crate: { max_stable_version: '1.53.1' },
        versions: [
          { num: '1.54.0-beta', license: 'BETA' },
          { num: '1.53.1', license: 'MIT' },
        ],
      }),
    })) as unknown as typeof fetch;
    const r = await fetchCratesLicense('tokio', null, f);
    expect(r.spdx).toBe('MIT');
    expect(r.fromLatest).toBeUndefined();
  });

  it('固定版が取れなければ最新に落とし、その旨を示す', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/9.9.9')) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({ crate: { max_stable_version: '1.0.0' }, versions: [{ num: '1.0.0', license: 'MIT' }] }),
      };
    }) as unknown as typeof fetch;
    const r = await fetchCratesLicense('x', '9.9.9', f);
    expect(r.spdx).toBe('MIT');
    expect(r.fromLatest).toBe(true);
  });

  it('取得できなければ null', async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect((await fetchCratesLicense('nope', null, f)).spdx).toBeNull();
  });
});
