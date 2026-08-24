import { describe, expect, it, vi } from 'vitest';
import {
  CLEARLYDEFINED_TIMEOUT_MS,
  fetchGoLicense,
  toGoCoordinates,
} from '../../src/resolver/clearlydefined';
import { UPSTREAM_TIMEOUT_MS } from '../../src/resolver/http';

/**
 * ClearlyDefined だけ待ち時間を短くしている理由。
 *
 * 実測（実在の go.sum から取った固定版 120 件）では、
 * **解決できる座標は必ず速い**（中央 1.0 秒 / p99 2.75 秒 / 最大 2.75 秒）。
 * 一方 38% は 6 秒を過ぎても返らない。これは未収録の座標を要求された
 * ClearlyDefined がその場で harvest を始めるためで、待っても答えは出ない。
 *
 * つまり 5 秒のうち後半は**必ず無駄**。ここを詰めた分だけ、同じ時間予算で
 * 確認できる依存が増える。
 */
describe('ClearlyDefined の待ち時間', () => {
  it('既定より短く、しかし解決できる座標を取りこぼさない', () => {
    expect(CLEARLYDEFINED_TIMEOUT_MS).toBeLessThan(UPSTREAM_TIMEOUT_MS);
    // 実測 p99 = 2751ms。ここを下回ると、解決できたはずの依存が
    // 「未確認」に落ちる。安全側に倒れるとはいえ、答えが減るのは損失
    expect(CLEARLYDEFINED_TIMEOUT_MS).toBeGreaterThanOrEqual(3_000);
  });
});

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
