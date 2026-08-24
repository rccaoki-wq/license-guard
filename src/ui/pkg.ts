import { verdictMatrix } from '../policy/matrix';
import { findLicense } from '../seo/catalog';
import {
  MODEL_LABEL,
  faqJsonLd,
  faqSection,
  esc,
  obligationBadges,
  renderLayout,
  scanCta,
  verdictTable,
} from './layout';
import type { Ecosystem, Linkage } from '../types';

export const ECOSYSTEM_LABEL: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  go: 'Go module',
  cargo: 'Rust crate',
};

const MANIFEST_NAME: Record<Ecosystem, string> = {
  npm: 'package-lock.json',
  pypi: 'requirements.txt',
  go: 'go.sum',
  cargo: 'Cargo.lock',
};

/** Go / Rust は静的リンクが既定 */
export const DEFAULT_LINKAGE: Record<Ecosystem, Linkage> = {
  npm: 'dynamic',
  pypi: 'dynamic',
  go: 'static',
  cargo: 'static',
};

export interface PackagePageInput {
  ecosystem: Ecosystem;
  name: string;
  spdx: string;
}

export function packagePath(ecosystem: Ecosystem, name: string): string {
  // Go のモジュールパスはスラッシュを含むため、そのまま経路に載せる
  return ecosystem === 'go'
    ? `/pkg/go/${name}`
    : `/pkg/${ecosystem}/${encodeURIComponent(name)}`;
}

export function renderPackagePage(input: PackagePageInput): string {
  const { ecosystem, name, spdx } = input;
  const linkage = DEFAULT_LINKAGE[ecosystem];
  const rows = verdictMatrix(spdx, 'runtime', linkage);
  const dev = verdictMatrix(spdx, 'dev', linkage)[0]!;
  const known = findLicense(spdx);

  const blocked = rows.filter((r) => r.verdict === 'blocked');
  const eco = ECOSYSTEM_LABEL[ecosystem];

  const headline =
    blocked.length === 0
      ? `${name} is licensed under ${spdx}, which imposes no source-disclosure obligation in any of the shipping models below.`
      : `${name} is licensed under ${spdx}. That triggers obligations in ${blocked.length} of the 5 common shipping models, so whether it is safe for you depends on how you ship.`;

  const title = `Is ${name} safe for commercial use? ${spdx} license obligations`;
  const description = `${name} (${eco}) is licensed under ${spdx}. See what that requires for hosted SaaS, distributed binaries, customer delivery, internal use, and published libraries.`;

  // 本文と構造化データを同じ配列から作る
  const faqs = [
    { question: `Is ${name} safe for commercial use?`, answer: headline },
    ...rows.map((r) => ({
      question: `Can I use ${name} (${spdx}) in ${MODEL_LABEL[r.model]!.toLowerCase()}?`,
      answer: r.rationale,
    })),
    {
      question: `Does ${name} matter if it is only a build-time or dev dependency?`,
      answer: dev.rationale,
    },
  ];

  const body = `
<h1>Is <code>${esc(name)}</code> safe for commercial use?</h1>
<p class="sub"><a href="/packages">${esc(eco)} package</a> &middot; License: <a href="${known ? `/license/${encodeURIComponent(known.id)}` : '/licenses'}">${esc(spdx)}</a></p>

<p>${esc(headline)}</p>

<h2>Can I use ${esc(name)} in SaaS, a distributed app, or internally?</h2>
${verdictTable(rows)}

<h2>What obligations does ${esc(name)} carry?</h2>
<p>${obligationBadges(rows.find((r) => r.obligations.length > 0)?.obligations ?? [])}</p>

<div class="callout">
<p><strong>If you only use it at build time, the answer changes.</strong></p>
<p>${esc(dev.rationale)}</p>
</div>

${
  known
    ? `<h2>What is ${esc(known.id)}?</h2>
<p>${esc(known.summary)}</p>
<p><a href="/license/${encodeURIComponent(known.id)}">Full ${esc(known.id)} reference &rarr;</a></p>`
    : ''
}

${faqSection(faqs)}

${scanCta(`This page covers one package. Your ${MANIFEST_NAME[ecosystem]} has many more.`)}

<h2>How was this determined?</h2>
<p>The license was read from ${ecosystem === 'go' ? 'deps.dev, with ClearlyDefined as a fallback &mdash; Go has no central license metadata, so both curate it separately' : ecosystem === 'cargo' ? 'crates.io' : `the ${eco} registry`}, then evaluated against each shipping model. ${ecosystem === 'go' || ecosystem === 'cargo' ? 'Dependencies in this ecosystem are linked statically, which is assumed here.' : ''} Only the declared license is considered; code copied into a project's own source files is not detected by this method.</p>
`;

  return renderLayout({
    title,
    description,
    path: packagePath(ecosystem, name),
    body,
    // 本文の faqSection と同じ配列。判定文は verdictMatrix の出力で、
    // ここで書き起こさない
    jsonLd: faqJsonLd(faqs),
  });
}

export function renderPackageNotFound(ecosystem: Ecosystem, name: string): string {
  const body = `
<h1>No license found for <code>${esc(name)}</code></h1>
<p class="sub">${esc(ECOSYSTEM_LABEL[ecosystem])} package</p>
<p>Either this package does not exist, or the registry returned no license metadata for it. These are very different situations and this page cannot tell them apart, so no verdict is shown.</p>
<p>A package that genuinely declares no license is all rights reserved by default, which is more restrictive than any open source license — worth confirming against the project's own repository.</p>
${scanCta('Check the rest of your dependencies while you are here.')}
`;
  return renderLayout({
    title: `No license found for ${name}`,
    description: `No license metadata was returned for the ${ECOSYSTEM_LABEL[ecosystem]} package ${name}.`,
    path: packagePath(ecosystem, name),
    body,
  });
}
