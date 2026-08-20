# LicenseGuard

*English | [日本語](README.ja.md)*

**Does this dependency's license create an obligation for the way *you* ship software?**

Generic license scanners answer a different question — "what license is this?" — and then warn on everything. LicenseGuard evaluates the license against your distribution model, so the same license produces different verdicts depending on how the software reaches its users.

Live: **https://license-guard.rcc-aoki.workers.dev**

## Why the distribution model decides it

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

## Use it from your coding agent

You need this when you are **adding a dependency**, not when you are searching the web. So the primary surface is an MCP tool, not a search result.

**Hosted** — nothing to install:

```bash
claude mcp add licenseguard --transport http https://license-guard.rcc-aoki.workers.dev/mcp
```

**Local (stdio)** — your manifest never leaves your machine. Only package names and versions are sent to public registries to look up licenses:

```bash
docker build -t licenseguard .
claude mcp add licenseguard -- docker run -i --rm licenseguard
```

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
| `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml` | direct only | yes |

Problem licenses usually arrive as a dependency of a dependency, not as something you added on purpose — so the lockfile path is the one that matters. `package-lock.json` v2/v3 embeds a license for every entry, which means a full transitive audit with **zero network lookups** and the exact versions that will actually be installed.

**An incomplete scan is never reported as clean.** Dependencies that could not be resolved appear as `not-checked` or `review` and are counted in the summary. They never become `allowed`.

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
| Go license data | ClearlyDefined API | Apache-2.0 |

## Privacy

The hosted service does not store manifest contents, package names, or IP addresses. What it does record is the shape of usage: which tool was called, for which ecosystem and distribution model, what verdict came back, and an opaque session identifier so that repeat use can be counted at all. See [`src/mcp/telemetry.ts`](src/mcp/telemetry.ts) for the exact fields.

The session identifier is issued as the spec's `Mcp-Session-Id` header. It is a random value with no meaning outside this database, it is never required, and it never expires — clients that ignore it keep working.

If that is still more than your organization wants to share, run the local stdio server. It sends nothing but package names and versions, and only to the public registries that already publish them.

## Disclaimer

LicenseGuard provides **information** derived from published license texts and declared dependency metadata. It is not legal advice, and using it does not create an attorney-client relationship. Verdicts rest on the license information a package declares; they do not claim to identify every obligation or violation.

## License

Apache-2.0
