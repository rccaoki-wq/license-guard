import { describe, expect, it, vi } from 'vitest';
import { fetchNpmLicense } from '../../src/resolver/npm';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchNpmLicense', () => {
  it('指定バージョンのライセンスを返す', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '4.18.2' },
      versions: { '4.18.2': { license: 'MIT' } },
    });
    expect(await fetchNpmLicense('express', '4.18.2', f)).toBe('MIT');
  });

  it('version が null なら latest のライセンスを返す', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '5.0.0' },
      versions: { '5.0.0': { license: 'Apache-2.0' } },
    });
    expect(await fetchNpmLicense('foo', null, f)).toBe('Apache-2.0');
  });

  it('レガシーなオブジェクト形式の license を扱う', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { license: { type: 'BSD-3-Clause', url: 'x' } } },
    });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBe('BSD-3-Clause');
  });

  it('レガシーな licenses 配列を OR で結合する', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] } },
    });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBe('(MIT OR GPL-2.0)');
  });

  it('ライセンス情報がなければ null を返す', async () => {
    const f = mockFetch({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    const f = mockFetch({}, false);
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBeNull();
  });

  it('スコープ付き名を URL エンコードする', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toContain('%40types%2Fnode');
      return {
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { license: 'MIT' } },
        }),
      };
    }) as unknown as typeof fetch;
    await fetchNpmLicense('@types/node', '1.0.0', f);
  });
});
