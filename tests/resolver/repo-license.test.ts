import { describe, expect, it, vi } from 'vitest';
import {
  fetchRepoLicense,
  githubRepoFromModulePath,
  identifyLicenseText,
} from '../../src/resolver/repo-license';
import { fetchGoLicenseWithFallback } from '../../src/resolver/go';
import { categorize } from '../../src/policy/categories';

/**
 * 実物の冒頭。整形（改行・字下げ）まで含めて本物に合わせてある。
 * 手で書き直した「それっぽい文」で通してしまうと、本番だけ落ちる
 */
const VAULT_BUSL = `License text copyright (c) 2020 MariaDB Corporation Ab, All Rights Reserved.
"Business Source License" is a trademark of MariaDB Corporation Ab.

Parameters

Licensor:             International Business Machines Corporation (IBM)
Licensed Work:        Vault Version 1.15.0 or later. The Licensed Work is (c) 2024
                      IBM Corp.
Additional Use Grant: You may make production use of the Licensed Work, provided
                      Your use does not include offering the Licensed Work to third
                      parties on a hosted or embedded basis in order to compete.

Change Date:          Four years from the date the Licensed Work is published.

Change License:       MPL 2.0

For information about alternative licensing arrangements for the Licensed Work,
please contact licensing@hashicorp.com.

Notice

Business Source License 1.1

Terms

The Licensor hereby grants You the right to copy, modify, create derivative
works, redistribute, and make non-production use of the Licensed Work.`;

const GRAFANA_AGPL = `                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The GNU Affero General Public License is a free, copyleft license for
software and other kinds of works, specifically designed to ensure
cooperation with the community in the case of network server software.`;

/**
 * **これが本命の落とし穴。** MPL-2.0 の 1.12 は「副次ライセンス」の定義として
 * AGPL v3 の名前を丸ごと含む。実測で正規化後 2257 文字目——4000 バイト読む
 * 範囲の内側にある。全文検索で名前を探すと syncthing と mdBook が
 * AGPL-3.0 に化ける
 */
const SYNCTHING_MPL = `Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or otherwise becomes an owner of Covered Software.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.`;

const RCLONE_MIT = `Copyright (C) 2012 by Nick Craig-Wood https://www.craig-wood.com/nick/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell`;

const HUGO_APACHE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION`;

describe('identifyLicenseText', () => {
  it('本番で外していた 4 件を、本文どおりに読む', () => {
    // Vault / Consul / Terraform / Nomad は同じ BUSL の型。
    // ここを MPL-2.0 と表示していた——**許容側に外していた**
    expect(identifyLicenseText(VAULT_BUSL)).toBe('BUSL-1.1');
    expect(categorize('BUSL-1.1')).toBe('source-available');
  });

  it('BUSL の版は全文から読む（表題の窓には出てこない）', () => {
    // HashiCorp の LICENSE は商標の注記で始まり、版付きの表記は
    // 400 文字より後ろにしかない。表題の窓だけを見ると版が読めない
    expect(VAULT_BUSL.indexOf('Business Source License 1.1')).toBeGreaterThan(400);
    expect(identifyLicenseText(VAULT_BUSL)).toBe('BUSL-1.1');
  });

  it('MPL-2.0 を AGPL-3.0 と読まない', () => {
    // MPL-2.0 の 1.12 が AGPL の名前を含む。全文から名前を探すと、
    // 今正しく答えている syncthing・mdBook が AGPL に化ける
    expect(SYNCTHING_MPL.replace(/\s+/g, ' ')).toContain('GNU Affero General Public License');
    expect(identifyLicenseText(SYNCTHING_MPL)).toBe('MPL-2.0');
  });

  it('解決できなかった Go モジュールを読む', () => {
    expect(identifyLicenseText(GRAFANA_AGPL)).toBe('AGPL-3.0');
    expect(identifyLicenseText(HUGO_APACHE)).toBe('Apache-2.0');
    // rclone は COPYING に置いている
    expect(identifyLicenseText(RCLONE_MIT)).toBe('MIT');
  });

  it('版を勝手に補わない（-only / -or-later は本文に書かれていない）', () => {
    // どちらなのかは LICENSE ではなく各ソースの冒頭注記で決まる。
    // 読めていない区別を名乗るくらいなら、版だけの形で返す
    const id = identifyLicenseText(GRAFANA_AGPL);
    expect(id).not.toMatch(/-only|-or-later/);
    // それでも分類は正しく付く（接頭辞で引くため）
    expect(categorize(id!)).toBe('network-copyleft');
  });

  it('AGPL を GPL、LGPL を GPL と読まない（表題が部分一致する）', () => {
    const lgpl = 'GNU LESSER GENERAL PUBLIC LICENSE\n Version 3, 29 June 2007';
    const gpl = 'GNU GENERAL PUBLIC LICENSE\n Version 3, 29 June 2007';
    expect(identifyLicenseText(lgpl)).toBe('LGPL-3.0');
    expect(identifyLicenseText(gpl)).toBe('GPL-3.0');
    expect(identifyLicenseText(GRAFANA_AGPL)).toBe('AGPL-3.0');
  });

  it('BSD を MIT と読まない', () => {
    const bsd3 = `Copyright (c) 2009 The Go Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

   * Redistributions in binary form must reproduce the above copyright notice.
   * Neither the name of Google Inc. nor the names of its contributors may be
used to endorse or promote products derived from this software.`;
    expect(identifyLicenseText(bsd3)).toBe('BSD-3-Clause');
  });

  it('判定できないものは null（推測しない）', () => {
    for (const t of ['', '   ', 'See LICENSE.md in the parent directory.', 'Copyright 2020 Acme.']) {
      expect(identifyLicenseText(t), JSON.stringify(t)).toBeNull();
    }
  });
});

describe('githubRepoFromModulePath', () => {
  it('リポジトリ直下のモジュールだけを受ける', () => {
    expect(githubRepoFromModulePath('github.com/hashicorp/vault')).toBe('hashicorp/vault');
    expect(githubRepoFromModulePath('github.com/grafana/grafana')).toBe('grafana/grafana');
  });

  it('サブディレクトリのモジュールは断る', () => {
    // **今正しく答えているものを壊さないための一線。**
    // github.com/hashicorp/consul は BUSL-1.1 だが、
    // github.com/hashicorp/consul/sdk は MPL-2.0 のまま。
    // 直下の LICENSE をかぶせると、sdk の正しい答えを塗り替えてしまう
    expect(githubRepoFromModulePath('github.com/hashicorp/consul/sdk')).toBeNull();
    expect(githubRepoFromModulePath('github.com/hashicorp/consul/api')).toBeNull();
  });

  it('メジャー版の接尾辞はディレクトリではないので剥がす', () => {
    expect(githubRepoFromModulePath('github.com/go-redis/redis/v8')).toBe('go-redis/redis');
    expect(githubRepoFromModulePath('github.com/x/y/v12')).toBe('x/y');
  });

  it('GitHub 以外と、経路に使えない名前は断る', () => {
    for (const p of [
      'golang.org/x/text',
      'gopkg.in/yaml.v2',
      'github.com/onlyowner',
      'github.com',
      'github.com/../../etc',
      'github.com/a b/c',
    ]) {
      expect(githubRepoFromModulePath(p), p).toBeNull();
    }
  });
});

/** 名前ごとに応答を切り替える偽 fetch */
function repoRouter(files: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    const body = files[name];
    if (body === undefined) return { ok: false, text: async () => '' };
    return { ok: true, text: async () => body };
  }) as unknown as typeof fetch;
}

describe('fetchRepoLicense', () => {
  it('LICENSE を読んで答える', async () => {
    const r = await fetchRepoLicense('github.com/hashicorp/vault', repoRouter({ LICENSE: VAULT_BUSL }));
    expect(r.spdx).toBe('BUSL-1.1');
    // 出所は混ぜない。読んだ相手をそのまま名乗る
    expect(r.source).toBe('repo-license');
  });

  it('COPYING や LICENCE も探す', async () => {
    // rclone は COPYING、juju は英国綴りの LICENCE
    expect((await fetchRepoLicense('github.com/rclone/rclone', repoRouter({ COPYING: RCLONE_MIT }))).spdx).toBe('MIT');
    expect((await fetchRepoLicense('github.com/juju/juju', repoRouter({ LICENCE: GRAFANA_AGPL }))).spdx).toBe('AGPL-3.0');
  });

  it('既定ブランチを HEAD で指す（master のリポジトリがある）', async () => {
    const f = repoRouter({ LICENSE: GRAFANA_AGPL });
    await fetchRepoLicense('github.com/minio/minio', f);
    const urls = (f as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('https://raw.githubusercontent.com/minio/minio/HEAD/LICENSE');
  });

  it('読めない・判定できない場合は null（既存の解決に落とす）', async () => {
    expect((await fetchRepoLicense('github.com/x/y', repoRouter({}))).spdx).toBeNull();
    expect((await fetchRepoLicense('github.com/x/y', repoRouter({ LICENSE: 'Proprietary. Ask us.' }))).spdx).toBeNull();
    expect((await fetchRepoLicense('golang.org/x/text', repoRouter({ LICENSE: RCLONE_MIT }))).spdx).toBeNull();
  });

  it('通信が落ちても投げない', async () => {
    const boom = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect((await fetchRepoLicense('github.com/x/y', boom)).spdx).toBeNull();
  });
});

describe('Go の解決に差し込む位置', () => {
  /** raw.githubusercontent / deps.dev / proxy.golang.org / ClearlyDefined を出し分ける */
  function goRouter(opts: { license?: string; depsdev?: string[]; clearlydefined?: string }) {
    return vi.fn(async (url: string) => {
      if (url.includes('raw.githubusercontent.com')) {
        if (opts.license === undefined) return { ok: false, text: async () => '' };
        return { ok: true, text: async (): Promise<string> => opts.license ?? '' };
      }
      if (url.includes('deps.dev')) {
        if (opts.depsdev === undefined) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => ({ licenses: opts.depsdev }) };
      }
      // 版が無いときの ClearlyDefined はリビジョンを持たないので、
      // 先に proxy.golang.org で最新版を引く
      if (url.includes('proxy.golang.org')) {
        return {
          ok: true,
          json: async (): Promise<unknown> => ({ Version: 'v1.0.0' }),
          text: async (): Promise<string> => 'v1.0.0',
        };
      }
      if (opts.clearlydefined === undefined) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ licensed: { declared: opts.clearlydefined } }) };
    }) as unknown as typeof fetch;
  }

  it('版が無いときは LICENSE を先に読む', async () => {
    // 本番で起きていた形。ClearlyDefined の「最新」推測は MPL-2.0 のまま
    const r = await fetchGoLicenseWithFallback(
      'github.com/hashicorp/vault',
      null,
      goRouter({ license: VAULT_BUSL, clearlydefined: 'MPL-2.0' }),
    );
    expect(r.spdx).toBe('BUSL-1.1');
    expect(r.source).toBe('repo-license');
  });

  it('版が指定されていれば LICENSE は読まない', async () => {
    // 過去の版に今の LICENSE をかぶせない。Vault v1.9 は本当に MPL-2.0 だった
    const f = goRouter({ license: VAULT_BUSL, depsdev: ['MPL-2.0'] });
    const r = await fetchGoLicenseWithFallback('github.com/hashicorp/vault', 'v1.9.0', f);

    expect(r.spdx).toBe('MPL-2.0');
    expect(r.source).toBe('deps-dev');
    const urls = (f as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('raw.githubusercontent.com'))).toBe(false);
  });

  it('LICENSE が読めなければ従来どおりの順で落ちる', async () => {
    const r = await fetchGoLicenseWithFallback(
      'github.com/x/y',
      null,
      goRouter({ clearlydefined: 'BSD-3-Clause' }),
    );
    expect(r.spdx).toBe('BSD-3-Clause');
    expect(r.source).toBeUndefined();
  });
});
