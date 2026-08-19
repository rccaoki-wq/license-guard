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
    expect(await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).toBe('MIT');
  });

  it('NOASSERTION は null にする', async () => {
    const f = mockFetch({ licensed: { declared: 'NOASSERTION' } });
    expect(await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).toBeNull();
  });

  it('version が null なら null を返す（座標が定まらないため）', async () => {
    const f = mockFetch({ licensed: { declared: 'MIT' } });
    expect(await fetchGoLicense('github.com/a/b', null, f)).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    expect(await fetchGoLicense('github.com/a/b', 'v1.0.0', mockFetch({}, false))).toBeNull();
  });
});
