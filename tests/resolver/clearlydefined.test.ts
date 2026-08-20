import { describe, expect, it, vi } from 'vitest';
import { fetchGoLicense, toGoCoordinates } from '../../src/resolver/clearlydefined';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('toGoCoordinates', () => {
  it('namespace のスラッシュをエンコードする', () => {
    expect(toGoCoordinates('github.com/gin-gonic/gin', 'v1.9.1')).toBe(
      'go/golang/github.com%2Fgin-gonic/gin/v1.9.1',
    );
  });

  it('深い階層は最後の要素を name、残りを namespace にする', () => {
    expect(toGoCoordinates('gopkg.in/yaml.v3', 'v3.0.1')).toBe(
      'go/golang/gopkg.in/yaml.v3/v3.0.1',
    );
  });

  it('スラッシュを含まないモジュールは namespace を - にする', () => {
    expect(toGoCoordinates('rsc.io', 'v1.0.0')).toBe('go/golang/-/rsc.io/v1.0.0');
  });
});

describe('fetchGoLicense', () => {
  it('licensed.declared を返す', async () => {
    const f = mockFetch({ licensed: { declared: 'MIT' } });
    expect((await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).spdx).toBe('MIT');
  });

  it('NOASSERTION は null にする', async () => {
    const f = mockFetch({ licensed: { declared: 'NOASSERTION' } });
    expect((await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).spdx).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    expect((await fetchGoLicense('github.com/a/b', 'v1.0.0', mockFetch({}, false))).spdx).toBeNull();
  });
});

describe('fetchGoLicense — バージョン未指定', () => {
  it('version が null なら最新版を解決してから問い合わせる', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('proxy.golang.org')) {
        return { ok: true, json: async () => ({ Version: 'v1.12.0' }) };
      }
      return { ok: true, json: async () => ({ licensed: { declared: 'MIT' } }) };
    }) as unknown as typeof fetch;

    expect((await fetchGoLicense('github.com/gin-gonic/gin', null, f)).spdx).toBe('MIT');
    expect(calls[0]).toContain('proxy.golang.org');
    expect(calls[1]).toContain('v1.12.0');
  });

  it('最新版も引けなければ null', async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect((await fetchGoLicense('github.com/a/b', null, f)).spdx).toBeNull();
  });
});
