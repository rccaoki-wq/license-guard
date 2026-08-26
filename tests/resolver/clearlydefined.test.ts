import { describe, expect, it, vi } from 'vitest';
import {
  CLEARLYDEFINED_TIMEOUT_MS,
  dedupeAndTerms,
  fetchGoLicense,
  toGoCoordinates,
  usableDeclared,
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

/**
 * **この判定は ClearlyDefined の記録に対する規則で、生態系には依らない。**
 * 以前は nuget.ts に置いていたので Go の経路だけが素通りしていた。
 * ここに置いたことを、NuGet の記録と Go の記録の両方で固定する。
 */
describe('usableDeclared', () => {
  it('中身が空同然の値は答えとして採らない', () => {
    for (const d of [undefined, '', '   ', 'NOASSERTION', 'OTHER', 'non-standard', 'UNKNOWN']) {
      expect(usableDeclared(d), String(d)).toBeNull();
    }
  });

  /**
   * ScanCode は CLA・保証免責・特許条項・出所不明の言及にもこれを付ける。
   * どれも同梱コードの許諾ではない。実測で出た式をそのまま並べる
   */
  it('LicenseRef-scancode が混ざった式は丸ごと捨てる', () => {
    for (const d of [
      'RPL-1.5 AND LicenseRef-scancode-unknown-license-reference',
      'LicenseRef-scancode-unknown-license-reference AND MIT',
      'LicenseRef-scancode-generic-cla AND MIT',
      'BSD-3-Clause AND LicenseRef-scancode-google-patent-license-golang',
      'MPL-2.0 AND LicenseRef-scancode-warranty-disclaimer',
    ]) {
      expect(usableDeclared(d), d).toBeNull();
    }
  });

  it('まともな式はそのまま通す', () => {
    expect(usableDeclared('MIT')).toBe('MIT');
    expect(usableDeclared('  Apache-2.0  ')).toBe('Apache-2.0');
    expect(usableDeclared('MIT OR Apache-2.0')).toBe('MIT OR Apache-2.0');
  });
});

describe('dedupeAndTerms', () => {
  it('AND だけの式の重複を畳む', () => {
    expect(dedupeAndTerms('MIT AND MIT AND BSD-3-Clause AND BSD-3-Clause')).toBe(
      'MIT AND BSD-3-Clause',
    );
  });

  it('OR・括弧・WITH が混ざる式は触らない', () => {
    // 構造を壊しうるので、畳めるかどうか以前に手を出さない
    for (const e of ['MIT OR Apache-2.0', '(MIT AND MIT) OR GPL-2.0-only', 'GPL-2.0-only WITH Classpath-exception-2.0']) {
      expect(dedupeAndTerms(e)).toBe(e);
    }
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

  /**
   * **`LicenseRef-scancode-*` は走査器の推定であって発行者の宣言ではない。**
   *
   * この規則は NuGet の経路には前からあったが（MediatR の
   * `RPL-1.5 AND LicenseRef-scancode-unknown-license-reference`）、
   * 判定関数が nuget.ts に置かれていたので Go の経路は素通りだった。
   * 実在の go.mod 14 本を流したところ、deps.dev が負荷で落ちて
   * ClearlyDefined に落ちた座標で下の式がそのまま表示されていた。
   * `github.com/fatih/color` は素の MIT で、deps.dev は MIT と答える。
   *
   * もっともらしい誤りは、答えが無いことより悪い
   */
  it('LicenseRef-scancode を含む declared は採らない', async () => {
    for (const declared of [
      'LicenseRef-scancode-unknown-license-reference AND MIT',
      'LicenseRef-scancode-generic-cla AND MIT',
      'BSD-3-Clause AND LicenseRef-scancode-google-patent-license-golang',
    ]) {
      const f = mockFetch({ licensed: { declared } });
      expect((await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).spdx, declared).toBeNull();
    }
  });

  /**
   * ClearlyDefined は同じ項を並べた式を実際に返す。実測では consul の
   * サブモジュールが `MPL-2.0 AND BUSL-1.1 AND ... AND MPL-2.0 AND BUSL-1.1`
   * で、表に MPL-2.0 と BUSL-1.1 が 2 回ずつ出ていた
   */
  it('AND の重複項を畳む', async () => {
    const f = mockFetch({ licensed: { declared: 'MPL-2.0 AND BUSL-1.1 AND MPL-2.0 AND BUSL-1.1' } });
    expect((await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).spdx).toBe('MPL-2.0 AND BUSL-1.1');
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
