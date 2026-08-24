/**
 * パッケージページの一覧。
 *
 * **これが無いと `/pkg/*` は巡回されない。** sitemap に載せることと
 * 巡回されることは別で、Search Console 上の4枚は「検出 - インデックス未登録」
 * （前回のクロール: 該当なし）のまま止まっていた。sitemap は存在を伝えるだけで、
 * どこからもリンクされていないページに巡回の順番は回ってこない。
 *
 * 載せる集合は sitemap と同じ述語（`packagePageSaysSomething`）で決める。
 * 一覧と sitemap がずれると、リンクはあるのに提出されていないページや、
 * 提出したのにどこからも辿れないページができる。**判定は 1 箇所に置く。**
 */
import { verdictMatrix } from '../policy/matrix';
import { packagePageSaysSomething, type SitemapPackage } from '../seo/sitemap';
import { ECOSYSTEM_LABEL, packagePath } from './pkg';
import { collectionJsonLd, esc, renderLayout, scanCta } from './layout';
import type { Ecosystem } from '../types';

const ECOSYSTEM_ORDER: Ecosystem[] = ['npm', 'pypi', 'go', 'cargo'];

/** その SPDX が 5 つの配布モデルのうち何件で義務を生むか */
function affectedModels(spdx: string): number {
  return verdictMatrix(spdx).filter((r) => r.verdict !== 'allowed').length;
}

function dedupe(packages: SitemapPackage[]): SitemapPackage[] {
  const seen = new Set<string>();
  const out: SitemapPackage[] = [];
  for (const p of packages) {
    if (!packagePageSaysSomething(p.spdx)) continue;
    const path = packagePath(p.ecosystem, p.name);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(p);
  }
  return out;
}

export function renderPackageIndex(packages: SitemapPackage[]): string {
  const listed = dedupe(packages).sort((a, b) => a.name.localeCompare(b.name));

  const groups = ECOSYSTEM_ORDER.map((eco) => {
    const items = listed.filter((p) => p.ecosystem === eco);
    if (items.length === 0) return '';
    const rows = items
      .map((p) => {
        const n = affectedModels(p.spdx);
        return `<li><a href="${packagePath(p.ecosystem, p.name)}"><code>${esc(p.name)}</code></a> &mdash; ${esc(p.spdx)}, which applies in ${n} of the 5 shipping models.</li>`;
      })
      .join('\n');
    return `<h2>${esc(ECOSYSTEM_LABEL[eco])}</h2>\n<ul>\n${rows}\n</ul>`;
  })
    .filter(Boolean)
    .join('\n');

  const empty = listed.length === 0;

  const body = `
<h1>Packages with license obligations</h1>
<p class="sub">Dependencies whose answer depends on how you ship them.</p>

<p>Most packages do not need a page. A dependency under MIT, Apache-2.0 or BSD carries the same answer no matter what you are building: keep the notice, ship whatever you like. Writing that out once per package would say nothing the <a href="/licenses">license reference</a> does not already say.</p>

<p>The packages below are the other kind. Each one is licensed such that the verdict changes with the way the software reaches its users — safe inside a company, an obligation the moment it is hosted or handed to a customer. Those are the ones worth naming, because the license identifier alone does not tell you which situation you are in.</p>

${
  empty
    ? `<p>No package currently meets that bar. This list is built from dependencies that have actually been resolved through the scanner, filtered down to the ones whose verdict is not constant &mdash; so it stays empty until a copyleft or source-available dependency comes through. That is a reasonable state for it to be in; it is not an error.</p>`
    : groups
}

<h2>How a package gets on this list</h2>
<p>Entries come from lockfiles that have been scanned here. A package is listed only when its license produces different verdicts across the five shipping models, which rules out every permissive license by construction. The per-package pages are generated from the same rules the scanner uses, so a page never disagrees with a scan result.</p>

${scanCta('Your lockfile probably contains one of these. Find out which.')}
`;

  return renderLayout({
    title: 'Packages whose license obligations depend on how you ship',
    description:
      'Open source packages under copyleft and source-available licenses, with what each one obligates you to do for hosted SaaS, distributed binaries, customer delivery, internal use, and published libraries.',
    path: '/packages',
    body,
    jsonLd: collectionJsonLd({
      name: 'Packages with license obligations',
      description:
        'Dependencies whose license verdict changes with the distribution model, resolved per shipping model.',
      path: '/packages',
      items: listed.map((p) => ({
        name: `${p.name} (${p.spdx})`,
        path: packagePath(p.ecosystem, p.name),
      })),
    }),
  });
}
