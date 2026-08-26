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
import { DEFAULT_LINKAGE, ECOSYSTEM_LABEL, packagePath } from './pkg';
import { collectionJsonLd, esc, renderLayout, scanCta } from './layout';
import { ECOSYSTEMS, type Ecosystem, type Linkage } from '../types';

/**
 * 見出しを出す順。
 *
 * **`Ecosystem[]` ではなく `Record<Ecosystem, number>` で持つ。** 配列だと
 * 系を足したときに書き忘れても型が通り、その系のパッケージは一覧から
 * 黙って消える。ページは 200 を返し、sitemap にも載るのに、どこからも
 * リンクされない孤児になる。実際 rubygems の 6 ページがその状態だった。
 * Record なら足した瞬間に型検査が落ちる
 */
const ECOSYSTEM_RANK: Record<Ecosystem, number> = {
  npm: 0,
  pypi: 1,
  go: 2,
  cargo: 3,
  rubygems: 4,
  nuget: 5,
};

const ECOSYSTEM_ORDER = ECOSYSTEMS.slice().sort((a, b) => ECOSYSTEM_RANK[a] - ECOSYSTEM_RANK[b]);

/**
 * 一覧に出す一行。
 *
 * **件数は必ずそのエコシステムの既定リンク方式で数える。** 掲載の可否は
 * 静的・動的の両方を見て決めているので、既定を無視して数えると
 * LGPL の npm パッケージが「0 of the 5」と出る。載せた理由と正面から
 * 矛盾する表示だったので、数が 0 になる場合は件数ではなく
 * **何がその答えを左右しているのか**を書く。
 */
function reason(ecosystem: Ecosystem, spdx: string): string {
  const linkage = DEFAULT_LINKAGE[ecosystem];
  const rows = verdictMatrix(spdx, 'runtime', linkage);
  const n = rows.filter((r) => r.verdict !== 'allowed').length;

  if (n > 0) {
    return `${spdx}, which applies in ${n} of the ${rows.length} shipping models.`;
  }

  // 既定のリンク方式では全モデル allowed。**そうなる理由は2通りあり、
  // 取り違えると一覧が嘘をつく。** リンク方式で変わる型（LGPL）と、
  // どう配ってもどう繋いでも義務が残る型（MPL・EPL・CDDL）は別物。
  // 後者に「静的リンクなら話が違う」と書くと、読者は逆の対処をする
  const other: Linkage = linkage === 'dynamic' ? 'static' : 'dynamic';
  const linkageChangesIt = verdictMatrix(spdx, 'runtime', other).some(
    (r) => r.verdict !== 'allowed',
  );

  if (linkageChangesIt) {
    return linkage === 'dynamic'
      ? `${spdx}. Nothing is triggered while it is linked dynamically, which is how ${ECOSYSTEM_LABEL[ecosystem]} normally loads it — statically linking or bundling it is a different answer.`
      : `${spdx}. The obligations here turn on how it is linked rather than on how you ship.`;
  }

  return `${spdx}. Allowed in all ${rows.length} shipping models, which is not the same as obligation-free: source for the parts this license covers has to reach whoever receives the software, however you ship it.`;
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
      .map(
        (p) =>
          `<li><a href="${packagePath(p.ecosystem, p.name)}"><code>${esc(p.name)}</code></a> &mdash; ${esc(reason(p.ecosystem, p.spdx))}</li>`,
      )
      .join('\n');
    return `<h2>${esc(ECOSYSTEM_LABEL[eco])}</h2>\n<ul>\n${rows}\n</ul>`;
  })
    .filter(Boolean)
    .join('\n');

  const empty = listed.length === 0;

  const body = `
<h1>Packages with license obligations</h1>
<p class="sub">Dependencies that oblige you to do something &mdash; and what that something is.</p>

<p>Most packages do not need a page. A dependency under MIT, Apache-2.0 or BSD carries the same answer no matter what you are building: keep the notice, ship whatever you like. Writing that out once per package would say nothing the <a href="/licenses">license reference</a> does not already say.</p>

<p>The packages below are the other kind. Some are licensed such that the verdict changes with the way the software reaches its users — safe inside a company, an obligation the moment it is hosted or handed to a customer. Others come back allowed everywhere and still oblige you to hand over source for the parts the license covers, which is a very different position to be in than a permissive license that only asks you to keep a notice. Both are worth naming, because the license identifier alone does not tell you which of those you are holding.</p>

${
  empty
    ? `<p>No package currently meets that bar. This list is built from dependencies that have actually been resolved here, filtered down to the ones that oblige you to do something &mdash; so it stays empty until a copyleft or source-available dependency comes through. That is a reasonable state for it to be in; it is not an error.</p>`
    : groups
}

<h2>How a package gets on this list</h2>
<p>Entries come from lockfiles that have been scanned here and from packages that have been looked up directly. A package is listed when its license either produces different verdicts across the five shipping models, or obliges you to disclose source in all of them, or restricts what you may use it for at all. Permissive licenses are ruled out by construction: keeping the notice is the whole obligation, and the <a href="/licenses">license page</a> says that better than a page per package could. The per-package pages are generated from the same rules the scanner uses, so a page never disagrees with a scan result.</p>

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
        'Dependencies under licenses that oblige source disclosure, restrict use, or change verdict with the distribution model, resolved per shipping model.',
      path: '/packages',
      items: listed.map((p) => ({
        name: `${p.name} (${p.spdx})`,
        path: packagePath(p.ecosystem, p.name),
      })),
    }),
  });
}
