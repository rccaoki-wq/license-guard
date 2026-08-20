import { LICENSE_CATALOG, SEED_PACKAGES } from './catalog';
import { packagePath } from '../ui/pkg';
import { SITE_ORIGIN } from '../ui/layout';
import type { Ecosystem } from '../types';

/** sitemap 1ファイルあたりの URL 上限 */
const MAX_URLS = 50_000;

export interface SitemapPackage {
  ecosystem: Ecosystem;
  name: string;
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
 * 静的ページとライセンスページに加え、これまでに解決実績のあるパッケージを
 * 載せる。パッケージページは要求時に生成されるが、実績があるということは
 * ライセンスを解決できたということなので、中身のあるページになることが保証される。
 */
export function buildSitemap(packages: SitemapPackage[]): string {
  const paths = [
    '/',
    '/licenses',
    ...LICENSE_CATALOG.map((l) => `/license/${encodeURIComponent(l.id)}`),
  ];

  // 実績のあるパッケージを優先し、枠が余ればシードで埋める
  const seen = new Set<string>();
  const pkgPaths: string[] = [];

  for (const p of [...packages, ...SEED_PACKAGES]) {
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
