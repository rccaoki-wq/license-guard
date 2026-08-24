import { LICENSE_CATALOG } from './catalog';
import { packagePath } from '../ui/pkg';
import { COMPARE_PAIRS, comparePath } from '../ui/compare';
import { SITE_ORIGIN } from '../ui/layout';
import { verdictMatrix } from '../policy/matrix';
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
 */
export function packagePageSaysSomething(spdx: string): boolean {
  const verdicts = new Set(
    [...verdictMatrix(spdx, 'runtime', 'dynamic'), ...verdictMatrix(spdx, 'runtime', 'static')].map(
      (r) => r.verdict,
    ),
  );
  return verdicts.size > 1;
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
