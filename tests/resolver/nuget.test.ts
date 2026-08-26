import { describe, expect, it, vi } from 'vitest';
import {
  dedupeAndTerms,
  fetchNugetLicense,
  normalizeNugetVersion,
  readNuspecLicense,
} from '../../src/resolver/nuget';

const nuspec = (license: string): string =>
  `<?xml version="1.0"?><package><metadata><id>X</id>${license}</metadata></package>`;

/** flatcontainer と ClearlyDefined の応答を組み立てる */
function stub(opts: {
  nuspec?: Record<string, string>;
  versions?: string[];
  declared?: string;
}): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.includes('/index.json')) {
      return opts.versions
        ? { ok: true, json: async () => ({ versions: opts.versions }) }
        : { ok: false, json: async () => ({}) };
    }
    if (url.includes('clearlydefined')) {
      return opts.declared === undefined
        ? { ok: true, json: async () => ({}) }
        : { ok: true, json: async () => ({ licensed: { declared: opts.declared } }) };
    }
    const version = /flatcontainer\/[^/]+\/([^/]+)\//.exec(url)?.[1] ?? '';
    const body = opts.nuspec?.[version];
    return body === undefined
      ? { ok: false, text: async () => '', body: null }
      : { ok: true, text: async () => body, body: null };
  }) as unknown as typeof fetch;
}

describe('normalizeNugetVersion', () => {
  it('ビルドメタデータを落とす', () => {
    // 上流の欠落に見えた 404 は 13/13 これだった
    expect(normalizeNugetVersion('8.4.0+build.694')).toBe('8.4.0');
    expect(normalizeNugetVersion('6.0.553+0-sha.4e42dc24b-azdo.7673671')).toBe('6.0.553');
  });

  it('先頭の 0・0 の第 4 要素・2 要素の版を揃える', () => {
    expect(normalizeNugetVersion('1.02.3')).toBe('1.2.3');
    expect(normalizeNugetVersion('1.0.0.0')).toBe('1.0.0');
    expect(normalizeNugetVersion('4.5')).toBe('4.5.0');
  });

  it('0 でない第 4 要素は残す', () => {
    expect(normalizeNugetVersion('1.0.0.3')).toBe('1.0.0.3');
  });

  it('プレリリースは残して小文字にする', () => {
    expect(normalizeNugetVersion('6.0.0-Preview.7')).toBe('6.0.0-preview.7');
  });

  it('読めない形はそのまま返す（勝手に作らない）', () => {
    expect(normalizeNugetVersion('not-a-version')).toBe('not-a-version');
  });
});

describe('readNuspecLicense', () => {
  it('type="expression" を読む', () => {
    const r = readNuspecLicense(nuspec('<license type="expression">MIT</license>'));
    expect(r).toEqual({ expression: 'MIT', isFile: false });
  });

  it('licenses.nuget.org の URL は式そのもの（推測ではない）', () => {
    const r = readNuspecLicense(
      nuspec('<licenseUrl>https://licenses.nuget.org/Apache-2.0</licenseUrl>'),
    );
    expect(r.expression).toBe('Apache-2.0');
  });

  it('URL に入った式のエスケープを解く', () => {
    const r = readNuspecLicense(
      nuspec('<licenseUrl>https://licenses.nuget.org/MIT%20OR%20Apache-2.0</licenseUrl>'),
    );
    expect(r.expression).toBe('MIT OR Apache-2.0');
  });

  it('licenses.nuget.org 以外の URL からは式を作らない', () => {
    const r = readNuspecLicense(
      nuspec('<licenseUrl>https://github.com/acme/x/blob/main/LICENSE</licenseUrl>'),
    );
    expect(r.expression).toBeNull();
  });

  it('type="file" を式ではなく事実として持ち帰る', () => {
    const r = readNuspecLicense(nuspec('<license type="file">LICENSE.txt</license>'));
    expect(r).toEqual({ expression: null, isFile: true });
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

describe('fetchNugetLicense', () => {
  it('小文字化・正規化した座標で nuspec を引く', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: string) => {
      seen.push(url);
      return { ok: true, text: async () => nuspec('<license type="expression">MIT</license>') };
    }) as unknown as typeof fetch;

    const r = await fetchNugetLicense('Newtonsoft.Json', '13.0.3.0+meta', f);
    expect(r.spdx).toBe('MIT');
    expect(seen[0]).toContain('/newtonsoft.json/13.0.3/newtonsoft.json.nuspec');
  });

  it('固定版そのものが答えたら fromLatest は立てない', async () => {
    const r = await fetchNugetLicense(
      'X',
      '1.0.0',
      stub({ nuspec: { '1.0.0': nuspec('<license type="expression">MIT</license>') } }),
    );
    expect(r).toEqual({ spdx: 'MIT' });
  });

  it('固定版の nuspec が無ければ最新に落とし、その旨を示す', async () => {
    const r = await fetchNugetLicense(
      'X',
      '9.9.9',
      stub({
        versions: ['1.0.0', '2.0.0'],
        nuspec: { '2.0.0': nuspec('<license type="expression">MIT</license>') },
      }),
    );
    expect(r.spdx).toBe('MIT');
    expect(r.fromLatest).toBe(true);
  });

  it('版を指定しない問いに最新を答えても fromLatest は立てない', async () => {
    const r = await fetchNugetLicense(
      'X',
      null,
      stub({
        versions: ['1.0.0', '2.0.0'],
        nuspec: { '2.0.0': nuspec('<license type="expression">MIT</license>') },
      }),
    );
    expect(r.spdx).toBe('MIT');
    expect(r.fromLatest).toBeUndefined();
  });

  it('nuspec に式が無ければ ClearlyDefined へ、出所も伝える', async () => {
    const r = await fetchNugetLicense(
      'X',
      '1.0.0',
      stub({
        nuspec: { '1.0.0': nuspec('<license type="file">LICENSE.txt</license>') },
        declared: 'MIT AND MIT AND BSD-3-Clause',
      }),
    );
    // 「どこから読んだか」は「何が言えるか」とは別の事実
    expect(r).toEqual({ spdx: 'MIT AND BSD-3-Clause', source: 'clearlydefined' });
  });

  it('中身の無い答えを解決として数えない', async () => {
    // 件数だけ埋まって、利用者に見せられる情報は一つも増えない値
    for (const declared of ['non-standard', 'NOASSERTION', 'OTHER', 'UNKNOWN', '']) {
      const r = await fetchNugetLicense(
        'X',
        '1.0.0',
        stub({ nuspec: { '1.0.0': nuspec('<license type="file">L.txt</license>') }, declared }),
      );
      expect(r.spdx).toBeNull();
    }
  });

  it('scancode の推定は宣言として採らない', async () => {
    const r = await fetchNugetLicense(
      'MediatR',
      '14.2.0',
      stub({
        nuspec: { '14.2.0': nuspec('<license type="file">LICENSE</license>') },
        declared: 'RPL-1.5 AND LicenseRef-scancode-unknown-license-reference',
      }),
    );
    // もっともらしい誤りは、答えが無いことより悪い
    expect(r.spdx).toBeNull();
    expect(r.source).toBe('license-file');
  });

  it('本文同梱を「読めなかった」ではなく「読めない形で宣言されている」と返す', async () => {
    const r = await fetchNugetLicense(
      'AutoMapper',
      '16.2.0',
      stub({ nuspec: { '16.2.0': nuspec('<license type="file">LICENSE.txt</license>') } }),
    );
    expect(r).toEqual({ spdx: null, source: 'license-file' });
  });

  it('ライセンスの記載が一切なければ license-file を名乗らない', async () => {
    const r = await fetchNugetLicense(
      'X',
      '1.0.0',
      stub({ nuspec: { '1.0.0': nuspec('') } }),
    );
    expect(r).toEqual({ spdx: null });
  });
});
