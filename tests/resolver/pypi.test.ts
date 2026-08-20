import { describe, expect, it, vi } from 'vitest';
import { fetchPypiLicense } from '../../src/resolver/pypi';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchPypiLicense', () => {
  it('PEP 639 の license_expression を最優先する', async () => {
    // Flask など最新パッケージは classifiers を持たず license_expression のみを持つ
    const f = mockFetch({
      info: { license: null, license_expression: 'BSD-3-Clause', classifiers: [] },
    });
    expect((await fetchPypiLicense('flask', null, f)).spdx).toBe('BSD-3-Clause');
  });

  it('license_expression は classifiers より優先される', async () => {
    const f = mockFetch({
      info: {
        license_expression: 'Apache-2.0',
        classifiers: ['License :: OSI Approved :: MIT License'],
      },
    });
    expect((await fetchPypiLicense('foo', '1.0.0', f)).spdx).toBe('Apache-2.0');
  });

  it('classifiers を info.license より優先する', async () => {
    const f = mockFetch({
      info: {
        license: 'see LICENSE file',
        classifiers: ['License :: OSI Approved :: Apache Software License'],
      },
    });
    expect((await fetchPypiLicense('foo', '1.0.0', f)).spdx).toBe('Apache-2.0');
  });

  it('MIT の classifier を SPDX に変換する', async () => {
    const f = mockFetch({ info: { classifiers: ['License :: OSI Approved :: MIT License'] } });
    expect((await fetchPypiLicense('foo', null, f)).spdx).toBe('MIT');
  });

  it('classifier がなければ info.license が SPDX 相当なら採用する', async () => {
    const f = mockFetch({ info: { license: 'BSD-3-Clause', classifiers: [] } });
    expect((await fetchPypiLicense('foo', '1.0.0', f)).spdx).toBe('BSD-3-Clause');
  });

  it('info.license が自由記述なら null を返す', async () => {
    const f = mockFetch({
      info: { license: 'see the LICENSE file for details', classifiers: [] },
    });
    expect((await fetchPypiLicense('foo', '1.0.0', f)).spdx).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    expect((await fetchPypiLicense('foo', '1.0.0', mockFetch({}, false))).spdx).toBeNull();
  });

  it('version 指定時はバージョン付き URL を叩く', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://pypi.org/pypi/requests/2.31.0/json');
      return {
        ok: true,
        json: async () => ({
          info: { classifiers: ['License :: OSI Approved :: MIT License'] },
        }),
      };
    }) as unknown as typeof fetch;
    await fetchPypiLicense('requests', '2.31.0', f);
  });
});

describe('fetchPypiLicense — 存在しないバージョンへのフォールバック', () => {
  it('バージョン付きURLが404ならバージョン無しで再取得する', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/9.9.9/')) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({ info: { license_expression: 'BSD-3-Clause' } }),
      };
    }) as unknown as typeof fetch;

    expect((await fetchPypiLicense('flask', '9.9.9', f)).spdx).toBe('BSD-3-Clause');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('https://pypi.org/pypi/flask/json');
  });

  it('バージョン無しでも取れなければ null', async () => {
    const f = mockFetch({}, false);
    expect((await fetchPypiLicense('nope', '1.0.0', f)).spdx).toBeNull();
  });
});
