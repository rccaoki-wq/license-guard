import { describe, expect, it, vi } from 'vitest';
import { fetchLatestGoVersion, escapeModulePath } from '../../src/resolver/goproxy';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('escapeModulePath', () => {
  it('大文字を !小文字 にエスケープする（Goプロキシの仕様）', () => {
    expect(escapeModulePath('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml');
  });

  it('小文字のみのパスはそのまま', () => {
    expect(escapeModulePath('github.com/gin-gonic/gin')).toBe('github.com/gin-gonic/gin');
  });
});

describe('fetchLatestGoVersion', () => {
  it('Version を返す', async () => {
    const f = mockFetch({ Version: 'v1.12.0', Time: '2026-02-28T10:10:09Z' });
    expect(await fetchLatestGoVersion('github.com/gin-gonic/gin', f)).toBe('v1.12.0');
  });

  it('HTTP エラーなら null', async () => {
    expect(await fetchLatestGoVersion('github.com/a/b', mockFetch({}, false))).toBeNull();
  });

  it('Version が無ければ null', async () => {
    expect(await fetchLatestGoVersion('github.com/a/b', mockFetch({}))).toBeNull();
  });

  it('エスケープ済みパスで問い合わせる', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://proxy.golang.org/github.com/!burnt!sushi/toml/@latest');
      return { ok: true, json: async () => ({ Version: 'v1.0.0' }) };
    }) as unknown as typeof fetch;
    await fetchLatestGoVersion('github.com/BurntSushi/toml', f);
  });
});
