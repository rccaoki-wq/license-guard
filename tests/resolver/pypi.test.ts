import { describe, expect, it, vi } from 'vitest';
import { fetchPypiLicense } from '../../src/resolver/pypi';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchPypiLicense', () => {
  it('classifiers を info.license より優先する', async () => {
    const f = mockFetch({
      info: {
        license: 'see LICENSE file',
        classifiers: ['License :: OSI Approved :: Apache Software License'],
      },
    });
    expect(await fetchPypiLicense('foo', '1.0.0', f)).toBe('Apache-2.0');
  });

  it('MIT の classifier を SPDX に変換する', async () => {
    const f = mockFetch({ info: { classifiers: ['License :: OSI Approved :: MIT License'] } });
    expect(await fetchPypiLicense('foo', null, f)).toBe('MIT');
  });

  it('classifier がなければ info.license が SPDX 相当なら採用する', async () => {
    const f = mockFetch({ info: { license: 'BSD-3-Clause', classifiers: [] } });
    expect(await fetchPypiLicense('foo', '1.0.0', f)).toBe('BSD-3-Clause');
  });

  it('info.license が自由記述なら null を返す', async () => {
    const f = mockFetch({
      info: { license: 'see the LICENSE file for details', classifiers: [] },
    });
    expect(await fetchPypiLicense('foo', '1.0.0', f)).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    expect(await fetchPypiLicense('foo', '1.0.0', mockFetch({}, false))).toBeNull();
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
