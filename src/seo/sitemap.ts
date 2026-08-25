import { LICENSE_CATALOG } from './catalog';
import { packagePath } from '../ui/pkg';
import { COMPARE_PAIRS, comparePath } from '../ui/compare';
import { SITE_ORIGIN } from '../ui/layout';
import { verdictMatrix } from '../policy/matrix';
import { categorize } from '../policy/categories';
import type { Ecosystem } from '../types';

/** sitemap 1ファイルあたりの URL 上限 */
const MAX_URLS = 50_000;

export interface SitemapPackage {
  ecosystem: Ecosystem;
  name: string;
  spdx: string;
}

/**
 * そのパッケージページが、ライセンスページの言い直し以上のことを言うか。
 *
 * 許容ライセンスは配布モデルでもリンク方式でも結論が変わらないので、
 * パッケージページの中身は名前を除いてライセンスページと同じになる。
 * そういうページを何百件も自分から提出すると、サイト全体が薄いと見なされる。
 * ページ自体は消さない（リンクから来た人には答えを返す）。提出をやめるだけ。
 *
 * **「結論が分かれるか」だけを見ていたため、丸ごと落ちていた層が2つある。**
 *
 * 1つは MPL / EPL / CDDL のようなファイル単位コピーレフト。どの配布モデルでも
 * allowed なので落ちていたが、allowed の中身が MIT とは違う。表示を残すだけの
 * MIT に対して、こちらは改変したファイルのソースを渡す義務が付いてくる。
 * mdbook・syncthing・Consul・Vault・pikepdf――許容の次に多い層が 1 件も
 * 載っていなかった。
 *
 * もう1つは BUSL / SSPL / Elastic。全モデル review で並ぶので落ちていた。
 * ただしこの形は**解釈できなかった文字列と見分けが付かない**（"SEE LICENSE IN
 * LICENSE.md" も全モデル review・義務なしになる）。行列だけでは区別できないので、
 * ここだけは分類表に載っているかを併せて見る。載っていないものは
 * 「分かりません」としか書けないページなので出さない。
 */
export function packagePageSaysSomething(spdx: string): boolean {
  // npm の "UNLICENSED" は「このパッケージに許諾を与えない」という宣言で、
  // ほぼ常に非公開パッケージに付く。**これを提出してはいけない理由が2つある。**
  //
  // 1つは事実の問題。実際に `color-name` が MIT と unlicensed の両方で
  // 記録されていた（同名の私物が誰かの lockfile に入っていた）。どちらの行を
  // 見るかで判定が変わり、公開されている MIT のパッケージについて
  // 「許諾は無い」と書いたページを自分から提出しかねない。
  //
  // もう1つは、そもそも非公開パッケージの名前を検索結果に出す話になること。
  // 解決できなかった名前を書かないのと同じ理由で、これも出さない
  if (categorize(spdx) === 'none') return false;

  const rows = [
    ...verdictMatrix(spdx, 'runtime', 'dynamic'),
    ...verdictMatrix(spdx, 'runtime', 'static'),
  ];

  // 表示を維持する以上に、こちらが手を動かす必要がある義務。
  // attribution と patent-grant は許容ライセンスにも付くので数えない
  const mustAct = rows.some((r) =>
    r.obligations.some((o) => o === 'source-disclosure' || o === 'same-license'),
  );
  if (mustAct) return true;

  // 使い方で結論が分かれるなら、自分がどちら側かがそのページの答えになる
  if (new Set(rows.map((r) => r.verdict)).size > 1) return true;

  // 義務は無いが allowed でもない＝利用そのものに条件が付く型。
  // 分類できたものに限る（上のコメント参照）
  return rows.every((r) => r.verdict !== 'allowed') && categorize(spdx) !== 'unknown';
}

function xmlEscape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}

/**
 * sitemap.xml を組み立てる。
 *
 * 静的ページとライセンスページに加え、解決実績があり、かつ
 * ライセンスページには無い答えを持つパッケージだけを載せる。
 */
export function buildSitemap(packages: SitemapPackage[]): string {
  const paths = [
    '/',
    '/licenses',
    '/compare',
    '/packages',
    ...LICENSE_CATALOG.map((l) => `/license/${encodeURIComponent(l.id)}`),
    ...COMPARE_PAIRS.map(comparePath),
  ];

  const seen = new Set<string>();
  const pkgPaths: string[] = [];

  for (const p of packages) {
    if (!packagePageSaysSomething(p.spdx)) continue;
    const path = packagePath(p.ecosystem, p.name);
    if (seen.has(path)) continue;
    seen.add(path);
    pkgPaths.push(path);
    if (paths.length + pkgPaths.length >= MAX_URLS) break;
  }

  const urls = [...paths, ...pkgPaths]
    .map((p) => `<url><loc>${xmlEscape(SITE_ORIGIN + p)}</loc></url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function buildRobotsTxt(): string {
  return `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
}
