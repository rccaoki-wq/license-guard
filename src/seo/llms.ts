import { LICENSE_CATALOG } from './catalog';
import { SITE_ORIGIN } from '../ui/layout';

/**
 * llms.txt — LLM とエージェントに、このサイトが何であり
 * どう機械的に利用できるかを一枚で伝える。
 *
 * 人間向けのナビゲーションと違い、ここでは MCP と JSON API を先頭に置く。
 * 読み手はページを巡回するのではなく、使えるインターフェースを探しているため。
 */
export function buildLlmsTxt(): string {
  return `# LicenseGuard

> Determines whether an open source dependency creates a legal obligation for the way a
> project is shipped. The same license yields different answers for hosted SaaS,
> distributed binaries, on-premises delivery, internal-only use, and published libraries.
> Most dependency scanners collapse that distinction; this one does not.

Informational only, not legal advice. Based on declared license metadata in package
manifests; code fragments copied into a project's own source are not detected.

## For agents

- [MCP server](${SITE_ORIGIN}/mcp): Streamable HTTP, stateless, no authentication.
  Tools: \`check_dependency_license\`, \`check_manifest_licenses\`, \`explain_license\`.
  Add with: \`claude mcp add licenseguard --transport http ${SITE_ORIGIN}/mcp\`
- [Package JSON API](${SITE_ORIGIN}/api/pkg/npm/express?model=saas): GET
  \`/api/pkg/{npm|pypi|go|cargo}/{name}?model={distribution_model}&scope={scope}\`
- [Manifest scan API](${SITE_ORIGIN}/api/scan): POST \`{"content": "...", "distributionModel": "saas"}\`

## Key facts

- AGPL-3.0 section 13 triggers on network interaction, so hosting it as SaaS creates a
  source-disclosure obligation. GPL-3.0 does not: its obligations attach to distribution,
  so hosting is unaffected while shipping a binary is not. These two are frequently confused.
- A dependency used only at build or test time does not carry distribution obligations,
  because it is not part of the shipped artifact.
- LGPL-family licenses turn on linkage. Static linking, normal for Go and Rust, triggers
  a relinking obligation that dynamic linking does not.
- SSPL, BUSL, and Elastic-2.0 are not OSI-approved open source and commonly forbid
  offering the software as a service.
- A package declaring no license at all is all rights reserved by default, which is more
  restrictive than any open source license.
- Lockfiles are the right input: problematic licenses usually arrive as transitive
  dependencies rather than ones you added directly, and only a lockfile reveals those.
  Accepted: package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, poetry.lock,
  uv.lock, plus the plain manifests.

## Reference pages

${LICENSE_CATALOG.map((l) => `- [${l.id}](${SITE_ORIGIN}/license/${encodeURIComponent(l.id)}): ${l.name}`).join('\n')}

## Optional

- [License index](${SITE_ORIGIN}/licenses)
- [Interactive scanner](${SITE_ORIGIN}/)
`;
}
