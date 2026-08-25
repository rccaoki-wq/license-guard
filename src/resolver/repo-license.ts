/**
 * リポジトリの LICENSE ファイルそのものを読む。
 *
 * **版を指定しない問い（＝公開している /pkg のページ）にだけ使う。**
 *
 * 版を指定しない問いは「このプロジェクトは今どういうライセンスか」だが、
 * deps.dev も ClearlyDefined も答えるのは「収録されている版のスキャン結果」で、
 * 再ライセンスされたプロジェクトではそれが古いまま残る。実際に本番で
 * こうなっていた:
 *
 *   Vault / Consul / Terraform / Nomad …… MPL-2.0 と表示。実際は 2023 年 8 月に
 *   BUSL-1.1 へ移行済み。**許容側に外していた**ので、読んだ人は本番投入して
 *   よいと受け取る。この製品が最も外してはいけない向きの誤り。
 *   Grafana / MinIO / LXD …… 何も解決できず。実際は AGPL-3.0。
 *
 * LICENSE ファイルは上流のスキャン結果ではなく一次資料なので、この問いに
 * 対しては上流より強い。ただし当たらない時は静かに null を返し、
 * 既存の解決へそのまま落とす。**今答えられているものを壊さないこと**が
 * この層の最低条件。
 */
import type { LicenseLookup } from './index';

/** 一次資料を読むだけなので、上流 API ほど待つ理由が無い */
export const REPO_LICENSE_TIMEOUT_MS = 2_000;

/**
 * 探すファイル名。順に試し、最初に取れたものを読む。
 *
 * `LICENCE` は英国綴り。juju がこれで、外すと解決できないまま残る。
 */
const LICENSE_FILENAMES = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'COPYING', 'LICENCE'] as const;

/** 判定に必要なのは冒頭だけなので、全文は読まない */
const MAX_BYTES = 4_000;

/**
 * 名前で判別するライセンスを探す範囲。
 *
 * **全文を検索してはいけない。** MPL-2.0 は 1.12 で「副次ライセンス」を
 * 定義しており、その定義文が GPL・LGPL・AGPL の正式名称を丸ごと含んでいる。
 * 実測で正規化後 2257 文字目——4000 バイト読む範囲の内側にある。
 * 全文検索だと MPL-2.0 の LICENSE が AGPL-3.0 と判定され、
 * **syncthing と mdBook が今の正しい答えから転落する**。
 */
const TITLE_WINDOW = 400;

/**
 * 名前で判別する型。**最初に名前が出たものを採る。**
 *
 * 窓に入っているかどうかだけで決めると足りない。他のライセンスの名前は
 * 定義文や相互参照として本文に現れるが、**自分の表題より先には出てこない**。
 * 「窓の中にあるか」ではなく「どれが先に出たか」で見ることで、
 * 短い LICENSE でも参照に負けない。
 *
 * 版の読み取りが失敗したら null を返す。**そこで別の候補に移らない**——
 * 名前が先に出ている以上それがこのファイルのライセンスで、
 * 版が読めないなら「分からない」が正しい答えになる。
 */
const NAMED_LICENSES: ReadonlyArray<{
  name: string;
  id: (title: string, full: string) => string | null;
}> = [
  {
    name: 'Business Source License',
    id: (_title, full) => {
      // **版だけは全文から探す。** HashiCorp の LICENSE は
      // 「"Business Source License" は MariaDB の商標」という注記から始まり、
      // 版付きの表記（"the Business Source License 1.1"）は末尾の適用文まで
      // 出てこない。版は他のライセンス本文に紛れ込まないので、全文で安全
      const v = /business source license (\d+\.\d+)/.exec(full)?.[1];
      if (v === undefined) return 'BUSL-1.1';
      // 1.1 以外が現れたら、黙って 1.1 を名乗らず諦める
      return v === '1.1' ? 'BUSL-1.1' : null;
    },
  },
  { name: 'Server Side Public License', id: () => 'SSPL-1.0' },
  { name: 'Elastic License 2.0', id: () => 'Elastic-2.0' },
  {
    name: 'GNU Affero General Public License',
    id: (t) => (t.includes('version 3') ? 'AGPL-3.0' : null),
  },
  {
    name: 'GNU Lesser General Public License',
    id: (t) => (t.includes('version 3') ? 'LGPL-3.0' : t.includes('version 2.1') ? 'LGPL-2.1' : null),
  },
  {
    name: 'GNU General Public License',
    id: (t) => (t.includes('version 3') ? 'GPL-3.0' : t.includes('version 2') ? 'GPL-2.0' : null),
  },
  {
    name: 'Mozilla Public License',
    id: (t) => (t.includes('version 2.0') ? 'MPL-2.0' : t.includes('version 1.1') ? 'MPL-1.1' : null),
  },
  {
    name: 'Eclipse Public License',
    id: (t) =>
      t.includes('v 2.0') || t.includes('version 2.0')
        ? 'EPL-2.0'
        : t.includes('v 1.0') || t.includes('version 1.0')
          ? 'EPL-1.0'
          : null,
  },
  {
    name: 'Apache License',
    id: (t) => (t.includes('version 2.0') ? 'Apache-2.0' : null),
  },
];

/**
 * ライセンス本文から SPDX 識別子を判定する。
 *
 * **表題は「先に出た名前」で決める。** 単に「窓の中にあるか」で見ると、
 * MPL-2.0 が自分の 1.12 で引用している GPL/LGPL/AGPL の名前に負ける。
 * 引用は必ず自分の表題より後ろに来るので、位置で比べれば取り違えない。
 *
 * **版を勝手に補わないこと。** 本文からは版（3 か 2 か）までは読めるが、
 * `-only` か `-or-later` かは読めない——それは LICENSE ファイルではなく
 * 各ソースの冒頭注記で決まる。だから `AGPL-3.0` のような版だけの形で返す。
 * `categorize` はこれを接頭辞で正しく分類する。存在しない厳密さを
 * 名乗る方が、曖昧なまま正しいより悪い。
 */
export function identifyLicenseText(text: string): string | null {
  // 空白と改行の揺れを吸収する。整形が違うだけで見落とすのは事故
  const full = text.replace(/\s+/g, ' ').trim();
  if (full.length === 0) return null;

  const lower = full.toLowerCase();
  const title = lower.slice(0, TITLE_WINDOW);

  // 窓の中で**最も先に**名前が出たものを採る。同じ位置に複数当たったら
  // 長い方（"GNU Affero General Public License" は "GNU General Public
  // License" を含まないが、将来包含関係が増えても壊れないように）
  let best: { at: number; len: number; entry: (typeof NAMED_LICENSES)[number] } | null = null;
  for (const entry of NAMED_LICENSES) {
    const at = title.indexOf(entry.name.toLowerCase());
    if (at < 0) continue;
    if (best === null || at < best.at || (at === best.at && entry.name.length > best.len)) {
      best = { at, len: entry.name.length, entry };
    }
  }

  if (best !== null) {
    // 版は名前の後ろに続く。名前より前を版の探索に混ぜない
    return best.entry.id(title.slice(best.at), lower);
  }

  // ここから下は表題を持たない型。著作権表示が何行あっても届くよう、
  // 表題ではなく本文全体から固有の条項を探す。上の型はどれも
  // これらの文言を含まないので、順序で取り違えることは無い
  const body = (s: string): boolean => lower.includes(s.toLowerCase());

  // MIT と BSD は書き出しが似ているので、固有の条項で分ける。
  // BSD を MIT と読むと、名前の使用制限が消える
  if (body('Redistribution and use in source and binary forms')) {
    if (body('Neither the name of')) return 'BSD-3-Clause';
    if (body('Redistributions in binary form')) return 'BSD-2-Clause';
    return null;
  }
  // ISC は "free of charge" を含まないので、ここに来るのは MIT 系
  if (body('Permission is hereby granted, free of charge')) return 'MIT';
  if (body('Permission to use, copy, modify, and/or distribute this software')) return 'ISC';

  return null;
}

/**
 * Go のモジュールパスから GitHub のリポジトリを取り出す。
 *
 * **`github.com/owner/repo` ちょうどの形だけを受ける。**
 * サブディレクトリのモジュールはリポジトリ直下の LICENSE に**支配されない**。
 * 実例として `github.com/hashicorp/consul` は BUSL-1.1 だが
 * `github.com/hashicorp/consul/sdk` は MPL-2.0 のままで、ここを緩めると
 * 今正しく答えられている sdk を BUSL-1.1 に書き換えてしまう。
 *
 * 末尾の major 版（`/v2` など）はモジュールパスの規約であってディレクトリでは
 * ないので、これは剥がす。
 */
export function githubRepoFromModulePath(modulePath: string): string | null {
  const parts = modulePath.split('/').filter((p) => p.length > 0);
  if (parts[0] !== 'github.com') return null;

  const rest = parts.slice(1);
  const last = rest[rest.length - 1];
  // メジャー版の接尾辞が付くのは v2 以降。v1 は付かないので、
  // `github.com/x/v1` のような形はディレクトリとして扱う。
  // 桁で切ると v12 を落とすので、数として比べる
  const major = last === undefined ? null : /^v(\d+)$/.exec(last)?.[1];
  if (rest.length === 3 && major !== undefined && major !== null && Number(major) >= 2) rest.pop();
  if (rest.length !== 2) return null;

  const [owner, repo] = rest;
  if (!owner || !repo) return null;
  // 経路に使うので、想定外の文字が来たら諦める
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return `${owner}/${repo}`;
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(REPO_LICENSE_TIMEOUT_MS),
      // 既定の UA で弾く配信元があるため明示する
      headers: { 'User-Agent': 'license-guard (+https://licenseguard.tenchorooms.com)' },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, MAX_BYTES);
  } catch {
    return null;
  }
}

/**
 * リポジトリ直下の LICENSE を読んで判定する。
 * 読めない・判定できない場合は `{ spdx: null }` を返し、呼び出し側の
 * 既存の解決へ落とす。
 */
export async function fetchRepoLicense(
  modulePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  const repo = githubRepoFromModulePath(modulePath);
  if (repo === null) return { spdx: null };

  for (const name of LICENSE_FILENAMES) {
    // HEAD は既定ブランチを指す。master / main のどちらでも当たる
    // （minio は master なので、main 決め打ちだと落ちる）
    const text = await fetchText(`https://raw.githubusercontent.com/${repo}/HEAD/${name}`, fetchImpl);
    if (text === null) continue;
    const spdx = identifyLicenseText(text);
    if (spdx !== null) return { spdx, source: 'repo-license' };
    // ファイルはあったが読めなかった。別名を探しても同じものが出るだけ
    return { spdx: null };
  }
  return { spdx: null };
}
