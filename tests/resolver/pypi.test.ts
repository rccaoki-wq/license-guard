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

describe('曖昧な classifier の扱い', () => {
  it('"BSD License" は版を特定できないので info.license を優先する', async () => {
    // 2-Clause か 3-Clause かは classifier からは決まらない
    const f = mockFetch({
      info: { license: 'BSD-2-Clause', classifiers: ['License :: OSI Approved :: BSD License'] },
    });
    expect((await fetchPypiLicense('old-pkg', null, f)).spdx).toBe('BSD-2-Clause');
  });

  it('info.license が緩い表記でも解釈する', async () => {
    const f = mockFetch({
      info: { license: 'BSD 2-Clause', classifiers: ['License :: OSI Approved :: BSD License'] },
    });
    expect((await fetchPypiLicense('old-pkg', null, f)).spdx).toBe('BSD-2-Clause');
  });

  it('手がかりが無ければ従来どおり BSD-3-Clause に寄せる', async () => {
    const f = mockFetch({
      info: { license: '', classifiers: ['License :: OSI Approved :: BSD License'] },
    });
    expect((await fetchPypiLicense('old-pkg', null, f)).spdx).toBe('BSD-3-Clause');
  });

  it('曖昧でない classifier は info.license より優先する', async () => {
    // MIT License 分類子は一意に決まるので、自由記述より信頼できる
    const f = mockFetch({
      info: { license: 'see LICENSE', classifiers: ['License :: OSI Approved :: MIT License'] },
    });
    expect((await fetchPypiLicense('p', null, f)).spdx).toBe('MIT');
  });

  it('版を欠く GPL 分類子に版を補わない', async () => {
    // 「分からないなら厳しい方へ」で GPL-3.0-only にしていたが、
    // GPLv2 と GPLv3 は互いに非互換で、これは厳しめの答えではなく
    // 別のライセンスだという主張になる。族だけを答える
    const f = mockFetch({
      info: { classifiers: ['License :: OSI Approved :: GNU General Public License (GPL)'] },
    });
    expect((await fetchPypiLicense('p', null, f)).spdx).toBe('GPL');
  });
});

describe('自由記述の欄に、正しい SPDX 式が書かれていることがある', () => {
  /**
   * `info.license` は自由記述の欄だが、**そこに正しい SPDX 式を書く
   * パッケージが実在する。** aiohttp は "Apache-2.0 AND MIT"、
   * tqdm は "MPL-2.0 AND MIT"。どちらも PyPI 上位 150 件に入る。
   *
   * 以前はこれを捨てて「判定不能」を返していた。単一識別子の形
   * （空白を含まない）しか受け取らなかったため、空白を含む式が
   * すべて振るい落とされていた。**推測ではなく構文解析で確かめる**
   * ので、緩い方に外れることはない。
   */
  it('AND で結ばれた式を受け取る（aiohttp / tqdm の実データ）', async () => {
    for (const [name, expr] of [
      ['aiohttp', 'Apache-2.0 AND MIT'],
      ['tqdm', 'MPL-2.0 AND MIT'],
    ] as const) {
      const f = mockFetch({ info: { license: expr, classifiers: [] } });
      expect((await fetchPypiLicense(name, null, f)).spdx).toBe(expr);
    }
  });

  it('OR で結ばれた式も受け取る', async () => {
    const f = mockFetch({ info: { license: 'MIT OR Apache-2.0', classifiers: [] } });
    expect((await fetchPypiLicense('sniffio', null, f)).spdx).toBe('MIT OR Apache-2.0');
  });

  /**
   * 式の形は正しいのに、**要素の綴りだけが SPDX と違う**もの。
   * uritemplate は "BSD 3-Clause OR Apache-2.0"（ハイフンが空白）。
   * 単体の "BSD 3-Clause" は既に正規化できていたが、式の中に入ると
   * 丸ごと素通しされるため、直る機会が無いまま捨てられていた。
   *
   * **版を補う正規化はここでは採らない。** "GPL" を "GPL-3.0-only" に
   * するのは綴りの修正ではなく、宣言に無い版を名乗る主張になる。
   */
  it('要素の綴りだけが違う式を受け取る（uritemplate の実データ）', async () => {
    const f = mockFetch({ info: { license: 'BSD 3-Clause OR Apache-2.0', classifiers: [] } });
    expect((await fetchPypiLicense('uritemplate', null, f)).spdx).toBe(
      'BSD-3-Clause OR Apache-2.0',
    );
  });

  it('版を欠く総称は式の中でも補わない', async () => {
    // "BSD-3-Clause OR GPL" は綴りではなく版が欠けている。ここで
    // GPL-3.0-only に置き換えると、宣言に無い版を宣言されたことにする。
    //
    // **補わない結果、式全体が読めないものとして捨てられる（null）。**
    // それでよい。解決器は「解析器を通ったものだけを採る」規律で動いており、
    // ここで通してしまうと、宣言に無い版を名乗った文字列が
    // 「読めた答え」の顔で下流に流れる。読めないものは読めないと言う
    const f = mockFetch({ info: { license: 'BSD-3-Clause OR GPL', classifiers: [] } });
    expect((await fetchPypiLicense('nonexistent-pkg', null, f)).spdx).toBeNull();
  });

  /**
   * ここが肝心。**式として読めない散文は、今まで通り捨てる。**
   * 受け皿にすると、ライセンス本文がまるごと「ライセンス識別子」になる。
   */
  it('散文は受け取らない（実データで確かめる）', async () => {
    for (const prose of [
      'Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License',
      'wxWindows Library License (https://opensource.org/licenses/wxwindows.php)',
      'LGPL with exceptions',
      'BSD, Public Domain',
      'Dual License',
      'BSD 3-Clause License\n\n         Copyright (c) 2008-2011, AQR Capital Management',
    ]) {
      const f = mockFetch({ info: { license: prose, classifiers: [] } });
      expect((await fetchPypiLicense('foo', null, f)).spdx).toBeNull();
    }
  });

  it('綴りの揺れは別名で拾う（protobuf / multidict / transformers の実データ）', async () => {
    for (const [declared, expected] of [
      ['Apache License 2.0', 'Apache-2.0'],
      // transformers。語順が違うだけで別物として落ちていた
      ['Apache 2.0 License', 'Apache-2.0'],
      ['3-Clause BSD License', 'BSD-3-Clause'],
      ['ISC License', 'ISC'],
    ] as const) {
      const f = mockFetch({ info: { license: declared, classifiers: [] } });
      expect((await fetchPypiLicense('foo', null, f)).spdx).toBe(expected);
    }
  });
});

describe('JSON API が空でも、wheel のメタデータには書いてある', () => {
  /**
   * **PyPI の JSON API は PEP 639 の欄を埋めていないことがある。**
   * fsspec / azure-core / azure-identity / mypy-extensions は
   * `info.license`・`info.license_expression`・分類子のすべてが空なのに、
   * 配布物本体（wheel）のメタデータには
   * `License-Expression: BSD-3-Clause` と書かれている。
   *
   * これらは PyPI 上位 400 件に入る。JSON API だけを見ていた結果、
   * ライセンスが明記されているパッケージを「不明」と答えていた。
   *
   * 追加の照会は 1 回だけ。しかも JSON API で解決できなかったときにしか
   * 走らない（上位 400 件では 9 件）。
   */
  function routed(map: Record<string, unknown>, text?: string) {
    return vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('.metadata')) {
        if (text === undefined) return { ok: false, text: async () => '' };
        return { ok: true, text: async () => text };
      }
      const body = map[url as string] ?? map['*'];
      return body === undefined ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => body };
    }) as unknown as typeof fetch;
  }

  const emptyDoc = {
    info: { license: null, license_expression: null, classifiers: [] },
    urls: [
      { packagetype: 'sdist', url: 'https://files.pythonhosted.org/a.tar.gz' },
      {
        packagetype: 'bdist_wheel',
        url: 'https://files.pythonhosted.org/fsspec-1-py3-none-any.whl',
        'core-metadata': { sha256: 'x' },
      },
    ],
  };

  it('License-Expression を読む（fsspec の実データ）', async () => {
    const f = routed({ '*': emptyDoc }, 'Metadata-Version: 2.4\nName: fsspec\nLicense-Expression: BSD-3-Clause\nLicense-File: LICENSE\n');
    expect((await fetchPypiLicense('fsspec', null, f)).spdx).toBe('BSD-3-Clause');
  });

  it('自由記述の License 行も同じ規律で読む（tiktoken の実データ）', async () => {
    const f = routed({ '*': emptyDoc }, 'Metadata-Version: 2.1\nName: tiktoken\nLicense: MIT License\n');
    expect((await fetchPypiLicense('tiktoken', null, f)).spdx).toBe('MIT');
  });

  /**
   * メタデータ本体には README がまるごと入っている。**空行より後は読まない。**
   * 読むと本文中の "MIT License" のような語を識別子として拾う。
   */
  it('ヘッダ部分より後は読まない', async () => {
    const f = routed({ '*': emptyDoc }, 'Metadata-Version: 2.1\nName: x\nLicense-File: LICENSE\n\nLicense-Expression: MIT\n# README\n');
    expect((await fetchPypiLicense('x', null, f)).spdx).toBeNull();
  });

  it('Range で切れた行は使わない', async () => {
    // 末尾が改行で終わっていない＝値が途中で切れている可能性がある
    const f = routed({ '*': emptyDoc }, 'Metadata-Version: 2.4\nName: fsspec\nLicense-Expression: BSD-3-');
    expect((await fetchPypiLicense('fsspec', null, f)).spdx).toBeNull();
  });

  it('メタデータに書かれていない散文は拾わない', async () => {
    const f = routed({ '*': emptyDoc }, 'Metadata-Version: 2.1\nName: x\nLicense: see the LICENSE file\n');
    expect((await fetchPypiLicense('x', null, f)).spdx).toBeNull();
  });

  it('JSON API で解決できるなら追加の照会をしない', async () => {
    const doc = { info: { license_expression: 'MIT', classifiers: [] }, urls: emptyDoc.urls };
    const f = routed({ '*': doc }, 'License-Expression: Apache-2.0\n');
    expect((await fetchPypiLicense('x', null, f)).spdx).toBe('MIT');
    const calls = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => String(c[0]).endsWith('.metadata'))).toBe(false);
  });

  it('wheel が無ければ何もしない', async () => {
    const doc = { info: { classifiers: [] }, urls: [{ packagetype: 'sdist', url: 'https://x/a.tar.gz' }] };
    expect((await fetchPypiLicense('x', null, routed({ '*': doc }, 'License-Expression: MIT\n'))).spdx).toBeNull();
  });
});
