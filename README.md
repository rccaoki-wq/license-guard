# LicenseGuard

*English | [日本語](README.ja.md)*

[![Glama quality](https://glama.ai/mcp/servers/rccaoki-wq/license-guard/badges/score.svg)](https://glama.ai/mcp/servers/rccaoki-wq/license-guard)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.rccaoki--wq%2Flicense--guard-0a7c3f)](https://registry.modelcontextprotocol.io/v0/servers?search=license-guard)
[![License](https://img.shields.io/badge/license-Apache--2.0-1a5fd0)](LICENSE)

Also listed on [mcpservers.org](https://mcpservers.org/servers/rccaoki-wq/license-guard), [Smithery](https://smithery.ai/servers/rcc-aoki/license-guard), the [TensorBlock MCP Index](https://www.tensorblock.co/mcp/servers/github-rccaoki-wq-license-guard-1818e624), and the [Docker MCP catalog](https://github.com/docker/mcp-registry).

**Does this dependency's license create an obligation for the way *you* ship software?**

Generic license scanners answer a different question — "what license is this?" — and then warn on everything. LicenseGuard evaluates the license against your distribution model, so the same license produces different verdicts depending on how the software reaches its users.

Live: **https://licenseguard.tenchorooms.com**

<sub>The `workers.dev` origin below is the same deployment, kept as the stable endpoint the MCP catalogs point at.</sub>

## Why does the distribution model decide it?

| How you ship | AGPL-3.0 dependency |
|---|---|
| SaaS (network-accessible) | **blocked** — §13 network clause |
| Internal use only | allowed |
| Distributed binary / on-prem | **blocked** — inherited GPL distribution terms |
| **devDependency** (never in the artifact) | **allowed** |

That last row is the whole point. A build-time linter under AGPL never ships, so it triggers nothing — but tools that warn on it anyway train people to ignore every warning they produce.

The same split runs through the rest of the license landscape, and the distinctions are not interchangeable:

- **GPL** obligations attach to *distribution*. Running GPL code as a network service is not distribution.
- **AGPL** adds §13, which attaches to *network interaction* — a separate trigger from GPL's distribution terms. Citing §13 for a distribution case is simply wrong, and LicenseGuard doesn't.
- **MPL / EPL / CDDL** are file-scoped and **linkage-independent**. MPL-2.0 §3.3 explicitly permits distributing a Larger Work under your own terms. Applying LGPL's relinking logic to them produces false positives.
- **LGPL** is the one that actually depends on linkage: static linking carries a relinking obligation, dynamic linking does not.

Verdicts are stated as facts with the clause cited. LicenseGuard does not tell you what to do.

## Common questions

**Does the GPL apply if I only host the software and never distribute it?**
No. GPL-3.0 triggers its obligations on distribution. Hosted SaaS is not distribution, so no obligation arises *today* — but shipping the same software later, as an on-prem deployment, a binary, or a published library, would trigger whole-work source disclosure.

**Does the AGPL apply if I only host the software as a SaaS?**
Yes. AGPL-3.0 §13 requires that users interacting with a modified version over a network be offered the corresponding source of the whole work. This is the clause that makes AGPL behave differently from GPL for hosted services, and it is the entire practical difference between the two.

**Do build-time and dev dependencies create license obligations?**
No. A dev dependency is not part of the artifact you ship, so distribution-triggered obligations do not arise. Tools that *emit code into your output*, such as code generators, are a separate case worth checking individually.

**Is MIT safe for commercial use?**
Yes, in every distribution model. MIT asks for attribution and nothing more. Apache-2.0 reaches the same result while adding a patent grant and a NOTICE requirement — obligations, but ones that do not vary by how you ship.

**Does static linking change the answer?**
Only for LGPL, and only for compiled languages. LGPL's design is that you may use the library in a proprietary work provided the user can replace it, which dynamic linking gives you and static linking does not. Go and Rust link statically by default, and nothing in `Cargo.lock` or `go.sum` says so.

**Why does the same license give different answers for different projects?**
Because copyleft obligations attach to *events* — distributing, or letting users interact over a network — not to the presence of the code. Whether those events happen is a fact about your business, not about your repository, which is why a scanner that only reads your lockfile cannot decide it.

## Use it from your coding agent

You need this when you are **adding a dependency**, not when you are searching the web. So the primary surface is an MCP tool, not a search result.

**Hosted** — nothing to install:

```bash
claude mcp add licenseguard --transport http https://license-guard.rcc-aoki.workers.dev/mcp
```

**Local (stdio)** — your manifest never leaves your machine. Only package names and versions are sent to public registries to look up licenses:

```bash
claude mcp add licenseguard -- docker run -i --rm ghcr.io/rccaoki-wq/license-guard:1.1.0
```

The image is published on every release and declared as an OCI package in the official MCP registry, so clients that read the registry can install it without any of this. To build it yourself instead: `docker build -t licenseguard . && docker run -i --rm licenseguard`.

Both paths run **the same policy engine**. They cannot disagree — an end-to-end suite (`npm run e2e:stdio`) pins them together.

Stateless Streamable HTTP, no authentication, no session state.

| Tool | When to call it |
|---|---|
| `check_dependency_license` | Before adding a single dependency |
| `check_manifest_licenses` | To audit a whole manifest or lockfile |
| `explain_license` | To see what a license requires across every distribution model |

## Use it from anything else

The JSON API returns the same verdicts:

```bash
curl "https://license-guard.rcc-aoki.workers.dev/api/pkg/pypi/pyload-ng?model=saas"
# => {"license":"AGPL-3.0-only","verdict":"blocked", ...}
```

Scan a whole lockfile:

```bash
curl -X POST https://license-guard.rcc-aoki.workers.dev/api/scan \
  -H 'content-type: application/json' \
  -d "$(jq -Rs '{content: ., distributionModel: "saas"}' package-lock.json)"
```

An agent-facing index lives at [`/llms.txt`](https://license-guard.rcc-aoki.workers.dev/llms.txt).

## Supported manifests

Ecosystems: **npm · PyPI · Go modules · crates.io**

| Format | Transitive deps | Registry lookups |
|---|---|---|
| `package-lock.json` | yes | **none** — licenses are embedded |
| `pnpm-lock.yaml`, `yarn.lock` | yes | yes (amortized by a shared cache) |
| `go.sum` | yes | yes |
| `Cargo.lock`, `poetry.lock`, `uv.lock` | yes | yes |
| `Gemfile.lock` | yes | yes |
| `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml` | direct only | yes |

Problem licenses usually arrive as a dependency of a dependency, not as something you added on purpose — so the lockfile path is the one that matters. `package-lock.json` v2/v3 embeds a license for every entry, which means a full transitive audit with **zero network lookups** and the exact versions that will actually be installed.

**An incomplete scan is never reported as clean.** Dependencies that could not be resolved appear as `not-checked` or `review` and are counted in the summary. They never become `allowed`.

A single scan performs at most 300 registry lookups, which bounds what one request can cost. Cached packages don't consume that budget, so the ceiling only binds on packages nobody has looked up yet — a first scan of a ~1000-crate `Cargo.lock` typically leaves a few dozen entries marked `not-checked`, and scanning again resolves them (measured: servo's 1043 crates reach zero unresolved published crates on the second pass). The result says so explicitly rather than quietly showing a shorter list.

Git dependencies and members of the workspace being scanned are reported as `not-published` instead, across every format that identifies them — `Cargo.lock`'s `source` field, yarn's `workspace:` and `git+` protocols, pnpm's tarball URLs, and `package-lock.json`'s `resolved`. No public registry has license data for them, so they are never looked up. That is a different situation from hitting the lookup limit: re-scanning will not resolve them, and the result says so.

This matters for more than speed. A workspace member named after a package that also exists publicly — `utils`, `core`, or anything else generic — would otherwise be resolved against that unrelated public package and reported as `allowed`, because the workspace version (`0.0.0-use.local`) matches nothing and the lookup falls back to the latest release. Marking the origin is what stops a private package from inheriting a stranger's license.

Private registries are the deliberate exception. A `resolved` URL pointing somewhere other than npmjs is just as likely to be a transparent Artifactory or Nexus proxy serving the real public package, and nothing in the lockfile distinguishes the two — so those are still looked up, and still reported as `unresolved` if they fail.

## Status

**Phase 0 — validating willingness to pay.** The MCP server and the free web tool are live. Because the real point of use is inside an agent's workflow rather than a search result, the signal being measured is MCP installs and repeat tool calls, not click-through rate. The GitHub App (Phase 1) starts only if that signal shows up.

## Development

```bash
npm install
npm test           # unit tests
npm run typecheck
npm run coverage
npm run smoke      # live registry connectivity
npm run e2e        # end-to-end against production
                   #   ui           real browser (Playwright)
                   #   a11y         accessibility
                   #   mcp          official MCP SDK client
                   #   load         consistency under concurrency
                   #   adversarial  hostile input and boundaries
                   #   correctness  against known-good verdicts
                   #   operational  cross-path agreement, HTTP, caching
                   #   stdio        local and hosted paths must agree
npm run dev        # http://localhost:8787
npm run signals    # Phase 0 report: real usage only, test traffic excluded
```

`npm run signals` is the one that decides what happens next, so it is deliberately conservative: traffic marked synthetic (every E2E suite sets `x-licenseguard-synthetic: 1`), traffic from registry crawlers and grading bots, and rows written before attribution existed are all excluded and reported separately rather than silently dropped. **Anything it cannot attribute, it refuses to count as demand.**

Passing unit tests is not sufficient here. Several real defects only appeared once live registry data was involved, so `smoke` and `e2e` run against the real upstreams and must pass before a release.

Deploy:

```bash
npm run db:migrate
npm run deploy
```

Built on Cloudflare Workers + Hono + D1.

## Documentation

- Design spec: [docs/specs/2026-08-19-license-guard-design.md](docs/specs/2026-08-19-license-guard-design.md) (Japanese)
- Phase 0 implementation plan: [docs/superpowers/plans/2026-08-19-phase0-free-web-tool.md](docs/superpowers/plans/2026-08-19-phase0-free-web-tool.md) (Japanese)
- Registry publishing notes: [docs/PUBLISHING.md](docs/PUBLISHING.md) (Japanese)

## What this depends on

Given the subject matter, every dependency is deliberately MIT or Apache-2.0. Nothing here obliges disclosure for a SaaS deployment.

| Role | Package | License |
|---|---|---|
| SPDX expression parsing | `spdx-expression-parse` | MIT |
| Web framework | `hono` | MIT |
| Go license data | deps.dev API (fallback: ClearlyDefined) | Apache-2.0 |

## Privacy

The hosted service does not store manifest contents or IP addresses. What it records is the shape of usage: which tool was called, for which ecosystem and distribution model, what verdict came back, and an opaque session identifier so that repeat use can be counted at all. No package name appears in any of those rows. See [`src/mcp/telemetry.ts`](src/mcp/telemetry.ts) for the exact fields.

Package names **are** stored in one place, and it is worth being exact about which: a lookup that succeeds is cached as `(ecosystem, package, version) → SPDX id`, so the next caller does not hit the registry again. Three things follow from how that table is written, and each is pinned by a test:

- It has **no column for who asked.** Rows carry no session, no request, no address, so nothing in the cache can be traced back to a user — see [`migrations/0001_init.sql`](migrations/0001_init.sql).
- A name that **could not be resolved is never written** ([`src/resolver/index.ts`](src/resolver/index.ts) returns before the cache write). A package that is not on a public registry — an internal one — is exactly the case that fails to resolve.
- The cache is **not private**: it is what fills [`/sitemap.xml`](https://license-guard.rcc-aoki.workers.dev/sitemap.xml). Everything in it is already published on npm, PyPI, Go or crates.io under that name.

The session identifier is issued as the spec's `Mcp-Session-Id` header. It is a random value with no meaning outside this database, it is never required, and it never expires — clients that ignore it keep working.

If that is still more than your organization wants to share, run the local stdio server. It sends nothing but package names and versions, and only to the public registries that already publish them.

One thing worth stating plainly rather than leaving for someone to discover: the hosted site's **HTML pages** carry Cloudflare Web Analytics, because the zone it now sits on has it enabled. It is cookieless and aggregate, but it is a third-party script and it was not there before the domain moved. It is injected only into HTML — `/mcp`, `/api/*`, `/llms.txt` and `/sitemap.xml` are untouched, so agents and API callers never load it.

## Disclaimer

LicenseGuard provides **information** derived from published license texts and declared dependency metadata. It is not legal advice, and using it does not create an attorney-client relationship. Verdicts rest on the license information a package declares; they do not claim to identify every obligation or violation.

## License

Apache-2.0
