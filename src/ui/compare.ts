/**
 * ライセンス比較ページ。
 *
 * 人は「AGPL-3.0-only の SaaS における義務」とは聞かない。
 * 「AGPL と GPL は何が違うのか」と聞く。**比較が問いの自然な形**なのに、
 * それに答えるページが無かった。
 *
 * 内容は `verdictMatrix()` から生成する。ここで文章を書き起こすと、
 * ツールの答えと比較ページの答えが割れうる。**同じ問いに 2 つの答えを持たせない。**
 *
 * 組み合わせは全網羅しない。実際に迷う対から選ぶ。20×19 の総当たりは
 * 薄い内容のページを大量に作るだけで、誰の役にも立たない。
 */
import { verdictMatrix, type MatrixRow } from '../policy/matrix';
import { findLicense, type LicenseEntry } from '../seo/catalog';
import { esc, renderLayout, scanCta } from './layout';

export interface ComparePair {
  a: string;
  b: string;
  /** なぜこの2つが並べて問われるのか。1行 */
  why: string;
}

/**
 * 実際に迷われる対だけ。
 *
 * 選定の基準は「結論が配布モデルで入れ替わるか」「取り違えが実害を生むか」。
 * MIT と Apache-2.0 のように結論が同じものも、**違いが特許条項だけだと
 * 知ること自体に価値がある**ので入れてある。
 */
export const COMPARE_PAIRS: ComparePair[] = [
  {
    a: 'AGPL-3.0-only',
    b: 'GPL-3.0-only',
    why: 'The most consequential pair for anyone running a hosted service. They diverge on exactly one thing.',
  },
  {
    a: 'GPL-3.0-only',
    b: 'LGPL-3.0-only',
    why: 'Both are copyleft, but only one of them cares how you link.',
  },
  {
    a: 'AGPL-3.0-only',
    b: 'MPL-2.0',
    why: 'Often lumped together as "copyleft to avoid". They are not remotely the same obligation.',
  },
  {
    a: 'MIT',
    b: 'Apache-2.0',
    why: 'Same practical outcome for shipping. The difference is patents and NOTICE, not disclosure.',
  },
  {
    a: 'GPL-2.0-only',
    b: 'GPL-3.0-only',
    why: 'A version bump that changed what you must hand over with a device.',
  },
  {
    a: 'MPL-2.0',
    b: 'LGPL-3.0-only',
    why: 'Both are called "weak copyleft". Only one of them constrains how you link.',
  },
  {
    a: 'AGPL-3.0-only',
    b: 'SSPL-1.0',
    why: 'One is open source with a network clause; the other is not open source at all.',
  },
  {
    a: 'MIT',
    b: 'AGPL-3.0-only',
    why: 'The two ends of the range, for when the question is simply "how bad is this".',
  },
];

/** URL のスラッグ。`/compare/mit-vs-agpl-3.0-only` */
export function comparePath(pair: ComparePair): string {
  return `/compare/${slug(pair.a)}-vs-${slug(pair.b)}`;
}

const slug = (id: string) => id.toLowerCase();

/** スラッグから対を引く。大文字小文字と順序の違いは吸収する */
export function findPair(a: string, b: string): ComparePair | undefined {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return COMPARE_PAIRS.find(
    (p) =>
      (slug(p.a) === x && slug(p.b) === y) || (slug(p.a) === y && slug(p.b) === x),
  );
}

const MODEL_LABEL: Record<string, string> = {
  saas: 'Hosted SaaS',
  'distributed-binary': 'Distributed binary',
  'on-prem-delivery': 'On-premises delivery',
  'internal-only': 'Internal use only',
  'library-published': 'Published library',
};

const VERDICT_CLASS: Record<string, string> = {
  allowed: 'ok',
  review: 'warn',
  blocked: 'bad',
};

const VERDICT_LABEL: Record<string, string> = {
  allowed: 'No obligation',
  review: 'Needs review',
  blocked: 'Obligation triggered',
};

function sideBySide(rowsA: MatrixRow[], rowsB: MatrixRow[], a: string, b: string): string {
  const rows = rowsA
    .map((ra, i) => {
      const rb = rowsB[i]!;
      const differs = ra.verdict !== rb.verdict;
      return `<tr${differs ? ' class="differs"' : ''}>
  <td>${esc(MODEL_LABEL[ra.model] ?? ra.model)}</td>
  <td class="${VERDICT_CLASS[ra.verdict]}">${esc(VERDICT_LABEL[ra.verdict] ?? ra.verdict)}</td>
  <td class="${VERDICT_CLASS[rb.verdict]}">${esc(VERDICT_LABEL[rb.verdict] ?? rb.verdict)}</td>
  <td>${differs ? 'They differ here' : 'Same'}</td>
</tr>`;
    })
    .join('\n');

  return `<table>
<thead><tr><th>How you ship</th><th>${esc(a)}</th><th>${esc(b)}</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/**
 * 差がどこにあるかを 1 文で言う。
 *
 * 表を出して終わりにしない。読み手が知りたいのは「で、結局どう違うのか」で、
 * 表を見比べて自分で言語化させるのは、答えたことにならない。
 */
function summarise(rowsA: MatrixRow[], rowsB: MatrixRow[], a: string, b: string): string {
  const differing = rowsA
    .map((ra, i) => ({ ra, rb: rowsB[i]! }))
    .filter(({ ra, rb }) => ra.verdict !== rb.verdict);

  if (differing.length === 0) {
    return `<p><strong>For every way of shipping software, ${esc(a)} and ${esc(b)} reach the same verdict.</strong> Whatever separates them, it is not the obligation to disclose source. Read each license's own page for what else differs — patent grants and notice requirements are the usual answer.</p>`;
  }

  const items = differing
    .map(
      ({ ra, rb }) =>
        `<li><strong>${esc(MODEL_LABEL[ra.model] ?? ra.model)}</strong>: ${esc(a)} is <em>${esc(VERDICT_LABEL[ra.verdict]!.toLowerCase())}</em>, ${esc(b)} is <em>${esc(VERDICT_LABEL[rb.verdict]!.toLowerCase())}</em>. ${esc(ra.verdict === 'blocked' ? ra.rationale : rb.rationale)}</li>`,
    )
    .join('\n');

  return `<p><strong>They differ in ${differing.length} of the ${rowsA.length} ways you can ship software.</strong></p>
<ul>
${items}
</ul>`;
}

export function renderComparePage(pair: ComparePair): string | null {
  const ea = findLicense(pair.a);
  const eb = findLicense(pair.b);
  if (!ea || !eb) return null;

  const rowsA = verdictMatrix(pair.a);
  const rowsB = verdictMatrix(pair.b);

  const differing = rowsA.filter((ra, i) => ra.verdict !== rowsB[i]!.verdict).length;

  const title = `${pair.a} vs ${pair.b}: what actually differs, by how you ship`;
  const description =
    differing === 0
      ? `${pair.a} and ${pair.b} reach the same verdict for every distribution model. Here is what that means and what still separates them.`
      : `${pair.a} and ${pair.b} differ in ${differing} of 5 distribution models. Side by side, with the clause that causes each difference.`;

  const body = `
<h1>${esc(pair.a)} vs ${esc(pair.b)}</h1>
<p class="sub">${esc(pair.why)}</p>

<h2>Can you use them, and where?</h2>
${summarise(rowsA, rowsB, pair.a, pair.b)}

<h2>Side by side</h2>
<p>Runtime dependency, dynamically linked. A build-time-only dependency reaches no user and carries no distribution obligation, whichever license it uses.</p>
${sideBySide(rowsA, rowsB, pair.a, pair.b)}

<h2>${esc(pair.a)}</h2>
<p>${esc(ea.summary)}</p>
<p><a href="/license/${encodeURIComponent(pair.a)}">Full obligations for ${esc(pair.a)}</a></p>

<h2>${esc(pair.b)}</h2>
<p>${esc(eb.summary)}</p>
<p><a href="/license/${encodeURIComponent(pair.b)}">Full obligations for ${esc(pair.b)}</a></p>

${scanCta(`Want to know which of these your project actually depends on?`)}
`;

  return renderLayout({ title, description, path: comparePath(pair), body });
}

export function renderCompareIndex(): string {
  const items = COMPARE_PAIRS.map((p) => {
    const rowsA = verdictMatrix(p.a);
    const rowsB = verdictMatrix(p.b);
    const n = rowsA.filter((ra, i) => ra.verdict !== rowsB[i]!.verdict).length;
    const verdict =
      n === 0 ? 'Same verdict everywhere' : `Differ in ${n} of ${rowsA.length} shipping models`;
    return `<li><a href="${comparePath(p)}"><strong>${esc(p.a)} vs ${esc(p.b)}</strong></a> — ${esc(verdict)}. ${esc(p.why)}</li>`;
  }).join('\n');

  const body = `
<h1>License comparisons</h1>
<p class="sub">Which licenses actually differ, and where.</p>

<p>Two licenses can be described in nearly the same words and still produce opposite answers — or be described very differently and produce identical ones. What separates them is usually a single clause interacting with a single fact: how the software reaches its users.</p>

<ul>
${items}
</ul>

${scanCta(`Not sure which licenses your project pulls in? Paste a lockfile.`)}
`;

  return renderLayout({
    title: 'License comparisons: what actually differs between open source licenses',
    description:
      'AGPL vs GPL, GPL vs LGPL, MIT vs Apache-2.0 and more — compared by what each one obligates you to do, for each way of shipping software.',
    path: '/compare',
    body,
  });
}
