import { verdictMatrix } from '../policy/matrix';
import { categorize } from '../policy/categories';
import { LICENSE_CATALOG, type LicenseEntry } from '../seo/catalog';
import {
  esc,
  collectionJsonLd,
  faqJsonLd,
  faqSection,
  obligationBadges,
  renderLayout,
  scanCta,
  verdictTable,
  MODEL_LABEL,
} from './layout';
import type { LicenseCategory } from '../types';

const CATEGORY_LABEL: Record<LicenseCategory, string> = {
  'public-domain': 'Public domain dedication',
  permissive: 'Permissive',
  'file-copyleft': 'File-level copyleft',
  'library-copyleft': 'Library-level copyleft',
  'strong-copyleft': 'Strong copyleft',
  'network-copyleft': 'Network copyleft',
  'source-available': 'Source available (not OSI-approved)',
  'non-commercial': 'Non-commercial only',
  unknown: 'Unclassified',
  none: 'No license',
};

export function renderLicensePage(entry: LicenseEntry): string {
  const runtime = verdictMatrix(entry.id, 'runtime');
  const category = categorize(entry.id);
  const dev = verdictMatrix(entry.id, 'dev')[0]!;

  // 静的リンクで結論が変わるライセンスのみ、その表を追加で見せる
  const staticRows = verdictMatrix(entry.id, 'runtime', 'static');
  const linkageMatters = staticRows.some((r, i) => r.verdict !== runtime[i]!.verdict);

  const title = `${entry.name} (${entry.id}): obligations for SaaS, distribution, and internal use`;
  const description = `What ${entry.id} requires depending on how you ship your software. ${entry.summary.slice(0, 110)}`;

  // 本文と構造化データを**同じ配列から**作る。別々に書くと必ず食い違い、
  // 引用されたときにページに無いことを答えたことになる
  const faqs = [
    ...runtime.map((r) => ({
      question: `Can I use ${entry.id} in ${MODEL_LABEL[r.model].toLowerCase()}?`,
      answer: r.rationale,
    })),
    {
      question: `Does ${entry.id} matter if it is only a build-time or dev dependency?`,
      answer: dev.rationale,
    },
    ...(linkageMatters
      ? [
          {
            question: `Does static linking change what ${entry.id} requires?`,
            answer: `Yes. ${staticRows
              .filter((r, i) => r.verdict !== runtime[i]!.verdict)
              .map((r) => `${MODEL_LABEL[r.model]}: ${r.rationale}`)
              .join(' ')}`,
          },
        ]
      : []),
  ];

  const body = `
<h1>${esc(entry.name)}</h1>
<p class="sub"><code>${esc(entry.id)}</code> &middot; ${esc(CATEGORY_LABEL[category])}</p>

<p>${esc(entry.summary)}</p>

<h2>Does ${esc(entry.id)} apply differently to SaaS, distribution, and internal use?</h2>
<p>Yes. The same license produces different obligations depending on whether the software is distributed, hosted, or kept internal. This is the distinction most dependency scanners collapse.</p>
${verdictTable(runtime)}

<h2>What obligations does ${esc(entry.id)} impose?</h2>
<p>${obligationBadges(runtime.find((r) => r.obligations.length > 0)?.obligations ?? [])}</p>

<div class="callout">
<p><strong>As a build-time dependency it is a different question.</strong></p>
<p>${esc(dev.rationale)}</p>
</div>

${
  linkageMatters
    ? `<h2>Does static linking change what ${esc(entry.id)} requires?</h2>
<p>For compiled languages such as Go and Rust, dependencies are normally linked statically, which alters what ${esc(entry.id)} asks of you.</p>
${verdictTable(staticRows)}`
    : ''
}

${faqSection(faqs)}

${scanCta(`Want to know whether anything in your project is under ${entry.id}?`)}

<h2>Other licenses</h2>
<div class="grid">
${LICENSE_CATALOG.filter((l) => l.id !== entry.id)
  .slice(0, 12)
  .map(
    (l) =>
      `<a href="/license/${encodeURIComponent(l.id)}"><strong>${esc(l.id)}</strong><span>${esc(CATEGORY_LABEL[categorize(l.id)])}</span></a>`,
  )
  .join('')}
</div>
<p><a href="/licenses">See all licenses &rarr;</a></p>
`;

  return renderLayout({
    title,
    description,
    path: `/license/${encodeURIComponent(entry.id)}`,
    body,
    // 本文の faqSection と同じ配列。判定文は verdictMatrix の出力そのままで、
    // ここで書き起こさない。書き起こすと表と JSON-LD で違うことを言い始める
    jsonLd: faqJsonLd(faqs),
  });
}

export function renderLicenseIndex(): string {
  const groups = new Map<LicenseCategory, LicenseEntry[]>();
  for (const l of LICENSE_CATALOG) {
    const c = categorize(l.id);
    const list = groups.get(c) ?? [];
    list.push(l);
    groups.set(c, list);
  }

  const order: LicenseCategory[] = [
    'public-domain',
    'permissive',
    'file-copyleft',
    'library-copyleft',
    'strong-copyleft',
    'network-copyleft',
    'source-available',
    'non-commercial',
  ];

  const body = `
<h1>Open source licenses and what they require</h1>
<p class="sub">Grouped by how far their obligations reach. Each page shows the result for hosted SaaS, distribution, customer delivery, internal use, and published libraries.</p>

${order
  .filter((c) => groups.has(c))
  .map(
    (c) => `<h2>${esc(CATEGORY_LABEL[c])}</h2>
<div class="grid">
${groups
  .get(c)!
  .map(
    (l) =>
      `<a href="/license/${encodeURIComponent(l.id)}"><strong>${esc(l.id)}</strong><span>${esc(l.name)}</span></a>`,
  )
  .join('')}
</div>`,
  )
  .join('')}

${scanCta('Rather than look them up one by one, check what your project actually depends on.')}
`;

  return renderLayout({
    title: 'Open source licenses: obligations for SaaS, distribution, and internal use',
    description:
      'Reference for common open source licenses, grouped by how far their obligations reach — permissive, file-level and library-level copyleft, strong copyleft, network copyleft, and source-available.',
    path: '/licenses',
    body,
    // 一覧はリンクの塊にしか見えない。何の一覧かを明示しないと薄いページ扱いになる
    jsonLd: collectionJsonLd({
      name: 'Open source licenses and what they require',
      description:
        'Every license covered here, grouped by how far its obligations reach, with the result for hosted SaaS, distribution, customer delivery, internal use, and published libraries.',
      path: '/licenses',
      items: LICENSE_CATALOG.map((l) => ({
        name: `${l.id} — ${l.name}`,
        path: `/license/${encodeURIComponent(l.id)}`,
      })),
    }),
  });
}
