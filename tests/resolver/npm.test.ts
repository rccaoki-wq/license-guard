import { describe, expect, it, vi } from 'vitest';
import { fetchNpmLicense } from '../../src/resolver/npm';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchNpmLicense', () => {
  it('指定バージョンのライセンスを返す', async () => {
    const f = mockFetch({ version: '4.18.2', license: 'MIT' });
    expect(await fetchNpmLicense('express', '4.18.2', f)).toBe('MIT');
  });

  it('version が null なら latest のライセンスを返す', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://registry.npmjs.org/foo/latest');
      return { ok: true, json: async () => ({ license: 'Apache-2.0' }) };
    }) as unknown as typeof fetch;
    expect(await fetchNpmLicense('foo', null, f)).toBe('Apache-2.0');
  });

  it('レガシーなオブジェクト形式の license を扱う', async () => {
    const f = mockFetch({ license: { type: 'BSD-3-Clause', url: 'x' } });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBe('BSD-3-Clause');
  });

  it('レガシーな licenses 配列を OR で結合する', async () => {
    const f = mockFetch({ licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBe('(MIT OR GPL-2.0)');
  });

  it('ライセンス情報がなければ null を返す', async () => {
    const f = mockFetch({ version: '1.0.0' });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBeNull();
  });

  it('スコープ付き名を URL エンコードする', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://registry.npmjs.org/%40types%2Fnode/1.0.0');
      return { ok: true, json: async () => ({ license: 'MIT' }) };
    }) as unknown as typeof fetch;
    await fetchNpmLicense('@types/node', '1.0.0', f);
  });
});

describe('fetchNpmLicense — 存在しないバージョンへのフォールバック', () => {
  it('指定バージョンが 404 なら latest を引き直す', async () => {
    // "^5.6.0" は範囲であり、5.6.0 が公開されているとは限らない
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/5.6.0')) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ license: 'Apache-2.0' }) };
    }) as unknown as typeof fetch;

    expect(await fetchNpmLicense('typescript', '5.6.0', f)).toBe('Apache-2.0');
    expect(calls).toEqual([
      'https://registry.npmjs.org/typescript/5.6.0',
      'https://registry.npmjs.org/typescript/latest',
    ]);
  });

  it('存在するバージョンは latest を引かない（再ライセンス対策）', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ license: 'MIT' }) };
    }) as unknown as typeof fetch;

    expect(await fetchNpmLicense('relicensed', '1.0.0', f)).toBe('MIT');
    expect(calls).toHaveLength(1);
  });

  it('latest も取れなければ null', async () => {
    expect(await fetchNpmLicense('foo', '9.9.9', mockFetch({}, false))).toBeNull();
  });

  it('巨大なパッケージ全体文書を取得しない', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ license: 'MIT' }) };
    }) as unknown as typeof fetch;

    await fetchNpmLicense('typescript', null, f);
    // https://registry.npmjs.org/typescript は 15MB を超える
    expect(calls).not.toContain('https://registry.npmjs.org/typescript');
  });
});
