import { evaluateExpression } from '../policy/engine';
import { verdictMatrix } from '../policy/matrix';
import { LicenseResolver, type CacheLike, type Fetchers } from '../resolver';
import { scan, withProvenanceNote } from '../scan';
import { findLicense } from '../seo/catalog';
import { SITE_ORIGIN } from '../ui/layout';
import { packagePath } from '../ui/pkg';
import type { DistributionModel, Ecosystem, Linkage, Scope } from '../types';

const ECOSYSTEMS: readonly Ecosystem[] = ['npm', 'pypi', 'go', 'cargo'];
const MODELS: readonly DistributionModel[] = [
  'saas',
  'distributed-binary',
  'on-prem-delivery',
  'internal-only',
  'library-published',
];
const SCOPES: readonly Scope[] = ['runtime', 'dev', 'build', 'test', 'optional'];

const DEFAULT_LINKAGE: Record<Ecosystem, Linkage> = {
  npm: 'dynamic',
  pypi: 'dynamic',
  go: 'static',
  cargo: 'static',
};

const DISCLAIMER =
  'Informational only, not legal advice. Based on declared license metadata; copied code fragments are not detected.';

const MODEL_ENUM_DESCRIPTION =
  'How the software incorporating this dependency reaches its users. This determines the answer: "saas" = users reach it over a network; "distributed-binary" = shipped as an app or binary; "on-prem-delivery" = installed in a customer environment; "internal-only" = never leaves your organization; "library-published" = released for others to depend on.';

export interface ToolContext {
  cache: CacheLike;
  fetchers?: Fetchers;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function textResult(text: string, structured?: Record<string, unknown>): ToolResult {
  return structured
    ? { content: [{ type: 'text', text }], structuredContent: structured }
    : { content: [{ type: 'text', text }] };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

// ---------------------------------------------------------------------------
// ツール定義
// ---------------------------------------------------------------------------

const VERDICTS = ['allowed', 'review', 'blocked'] as const;

/**
 * 3 ツールに共通のふるまい。
 *
 * これを宣言する意味は、エージェントが**確認を挟まずに呼んでよいかを判断できる**こと。
 * どれも読み取りだけで、何も書かず、同じ引数なら同じ答えを返す。
 * 依存を追加する直前に呼ばせたい道具が、呼ぶたびに承認を求められては使われない。
 *
 * openWorld を true にしているのは、答えが外部レジストリの状態に依存するため。
 * 再ライセンスは実在するので、閉じた世界だと偽ることはできない。
 */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const TOOL_DEFINITIONS = [
  {
    name: 'check_dependency_license',
    title: 'Check one dependency for license obligations',
    description:
      'Determine whether adding or keeping a single open source dependency creates a legal obligation, given how this project ships. Call this BEFORE adding a new dependency to a project, and when auditing an existing one. A permissive result means no source-disclosure duty; a blocked result means the license obligates you and the dependency should be replaced or the shipping model reconsidered.',
    inputSchema: {
      type: 'object',
      properties: {
        ecosystem: {
          type: 'string',
          enum: ['npm', 'pypi', 'go', 'cargo'],
          description: 'Package registry the dependency comes from.',
        },
        name: {
          type: 'string',
          description:
            'Package name as written in the manifest, e.g. "express", "requests", "github.com/gin-gonic/gin", or "serde".',
        },
        version: {
          type: 'string',
          description:
            'Exact version if known. Omit to use the latest published version, which may differ from what is installed.',
        },
        distribution_model: {
          type: 'string',
          enum: MODELS,
          description: MODEL_ENUM_DESCRIPTION,
        },
        scope: {
          type: 'string',
          enum: SCOPES,
          description:
            'Where the dependency sits. Use "dev", "build", or "test" for anything that does not end up in the shipped artifact — those carry no distribution obligation. Defaults to "runtime".',
        },
      },
      required: ['ecosystem', 'name', 'distribution_model'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        license: { type: ['string', 'null'] },
        verdict: { type: 'string', enum: ['allowed', 'review', 'blocked'] },
        obligations: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' },
        reference: { type: 'string' },
      },
      required: ['license', 'verdict', 'obligations', 'rationale'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'check_manifest_licenses',
    title: 'Check a whole manifest',
    description:
      'Scan an entire dependency manifest and report every dependency whose license creates an obligation for this shipping model. Use when reviewing a project as a whole, preparing for due diligence, or after a large dependency change. Pass a package-lock.json when one exists: problematic licenses usually arrive as transitive dependencies rather than ones you added directly, and only a lockfile reveals those.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Full text of a lockfile or manifest. Accepted: package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, poetry.lock, uv.lock, package.json, requirements.txt, go.mod, Cargo.toml. The format is detected automatically. Prefer a lockfile: it covers transitive dependencies and carries exact versions. package-lock.json is best of all, since it embeds licenses and needs no registry lookups.',
        },
        distribution_model: {
          type: 'string',
          enum: MODELS,
          description: MODEL_ENUM_DESCRIPTION,
        },
      },
      required: ['content', 'distribution_model'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ecosystem: { type: 'string' },
        distributionModel: { type: 'string' },
        summary: {
          type: 'object',
          description:
            'Counts by verdict. total is every dependency found, not only the ones that were resolved.',
          properties: {
            total: { type: 'number' },
            allowed: { type: 'number' },
            review: { type: 'number' },
            blocked: { type: 'number' },
          },
          required: ['total', 'allowed', 'review', 'blocked'],
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ecosystem: { type: 'string' },
              name: { type: 'string' },
              version: { type: ['string', 'null'] },
              scope: { type: 'string', enum: SCOPES },
              spdxExpression: { type: ['string', 'null'] },
              resolvedFrom: {
                type: 'string',
                description:
                  'Where the license came from. "lockfile" is exact; "registry" and "deps-dev" are the pinned version as published; "registry-latest" means the pinned version could not be read and the latest release was used instead; "not-checked" means the lookup budget ran out and this dependency was never resolved; "not-published" means it is a git dependency, a member of the scanned workspace, or from a private registry, so no public registry has license data for it — re-scanning will not resolve those.',
              },
              verdict: { type: 'string', enum: VERDICTS },
              obligations: { type: 'array', items: { type: 'string' } },
              rationale: { type: 'string' },
            },
            required: ['ecosystem', 'name', 'scope', 'verdict', 'obligations', 'rationale'],
          },
        },
        limitations: {
          type: 'array',
          items: { type: 'string' },
          description:
            'What this scan could not establish. Never empty when anything was left unresolved. Read it before treating a result as clean.',
        },
      },
      required: ['summary', 'findings', 'limitations'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'explain_license',
    title: 'Explain what a license requires',
    description:
      'Given an SPDX license identifier or expression, explain what it requires across every shipping model at once. Use when the question is about the license itself rather than a specific package — for example when comparing AGPL-3.0 against GPL-3.0 for a hosted service, or deciding what a project may safely depend on.',
    inputSchema: {
      type: 'object',
      properties: {
        license: {
          type: 'string',
          description:
            'SPDX identifier or expression, e.g. "AGPL-3.0-only", "Apache-2.0", or "(MIT OR GPL-2.0-only)".',
        },
        linkage: {
          type: 'string',
          enum: ['dynamic', 'static', 'separate-process'],
          description:
            'How the dependency is linked. Matters for LGPL-family licenses. Compiled languages such as Go and Rust normally link statically. Defaults to "dynamic".',
        },
      },
      required: ['license'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        license: { type: 'string' },
        linkage: { type: 'string' },
        byDistributionModel: {
          type: 'array',
          description: 'One row per way of shipping. This is where the same license diverges.',
          items: {
            type: 'object',
            properties: {
              model: { type: 'string', enum: MODELS },
              verdict: { type: 'string', enum: VERDICTS },
              obligations: { type: 'array', items: { type: 'string' } },
              rationale: { type: 'string' },
            },
            required: ['model', 'verdict', 'obligations', 'rationale'],
          },
        },
        devScope: {
          type: 'object',
          description:
            'The result when the dependency never reaches users (dev, build or test scope). Independent of the shipping model.',
          properties: {
            verdict: { type: 'string', enum: VERDICTS },
            rationale: { type: 'string' },
          },
          required: ['verdict', 'rationale'],
        },
      },
      required: ['license', 'byDistributionModel', 'devScope'],
    },
    annotations: READ_ONLY,
  },
] as const;

// ---------------------------------------------------------------------------
// ツール実装
// ---------------------------------------------------------------------------

async function checkDependency(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const ecosystem = str(args['ecosystem']) as Ecosystem | undefined;
  const name = str(args['name']);
  const model = str(args['distribution_model']) as DistributionModel | undefined;
  const scope = (str(args['scope']) ?? 'runtime') as Scope;
  const version = str(args['version']) ?? null;

  if (!ecosystem || !ECOSYSTEMS.includes(ecosystem)) {
    return errorResult(`ecosystem must be one of: ${ECOSYSTEMS.join(', ')}`);
  }
  if (!name) return errorResult('name is required.');
  if (!model || !MODELS.includes(model)) {
    return errorResult(`distribution_model must be one of: ${MODELS.join(', ')}`);
  }
  if (!SCOPES.includes(scope)) {
    return errorResult(`scope must be one of: ${SCOPES.join(', ')}`);
  }

  const resolver = new LicenseResolver(ctx.cache, ctx.fetchers);
  const { spdx, resolvedFrom } = await resolver.resolve({ ecosystem, name, version, scope });

  const reference = SITE_ORIGIN + packagePath(ecosystem, name);

  if (resolvedFrom === 'unresolved') {
    const structured = {
      package: { ecosystem, name, version },
      license: null,
      licenseSource: resolvedFrom,
      distributionModel: model,
      scope,
      verdict: 'review',
      obligations: [] as string[],
      rationale:
        'The license could not be determined. Either none is declared, or the registry did not return one. A package genuinely published without a license is all rights reserved by default, which is more restrictive than any open source license.',
      reference,
    };
    return textResult(
      `${name}: LICENSE UNKNOWN — needs review.\n\n${structured.rationale}\n\nDo not treat this as "no license present"; the lookup itself may have failed. Check the project's repository directly.\n\n${DISCLAIMER}`,
      structured,
    );
  }

  const result = withProvenanceNote(
    evaluateExpression(spdx, {
      scope,
      linkage: DEFAULT_LINKAGE[ecosystem],
      distributionModel: model,
    }),
    resolvedFrom,
  );

  const headline =
    result.verdict === 'blocked'
      ? `${name} (${spdx}): OBLIGATION TRIGGERED for ${model}.`
      : result.verdict === 'review'
        ? `${name} (${spdx}): NEEDS REVIEW for ${model}.`
        : `${name} (${spdx}): no obligation for ${model}.`;

  const obligations =
    result.obligations.length > 0
      ? `\n\nWhat you must do: ${result.obligations.join(', ')}.`
      : '';

  const structured = {
    package: { ecosystem, name, version },
    license: spdx,
    licenseSource: resolvedFrom,
    distributionModel: model,
    scope,
    verdict: result.verdict,
    obligations: result.obligations,
    rationale: result.rationale,
    reference,
  };

  return textResult(
    `${headline}\n\n${result.rationale}${obligations}\n\nDetails: ${reference}\n\n${DISCLAIMER}`,
    structured,
  );
}

async function checkManifest(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const content = str(args['content']);
  const model = str(args['distribution_model']) as DistributionModel | undefined;

  if (!content) return errorResult('content is required.');
  if (!model || !MODELS.includes(model)) {
    return errorResult(`distribution_model must be one of: ${MODELS.join(', ')}`);
  }
  if (new TextEncoder().encode(content).length > 4_000_000) {
    return errorResult('content is too large (4MB limit).');
  }

  let result;
  try {
    result = await scan(content, model, ctx.cache, ctx.fetchers);
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : 'Scan failed.');
  }

  const notable = result.findings.filter((f) => f.verdict !== 'allowed');

  const lines = [
    `Scanned ${result.summary.total} direct ${result.ecosystem} dependencies for a ${model} project.`,
    `${result.summary.blocked} trigger an obligation, ${result.summary.review} need review, ${result.summary.allowed} are clear.`,
  ];

  if (notable.length === 0) {
    lines.push('\nNothing in this manifest obligates you under this shipping model.');
  } else {
    lines.push('\nItems requiring attention:');
    for (const f of notable) {
      lines.push(
        `\n- ${f.name}${f.version ? '@' + f.version : ''} [${f.scope}] — ${f.spdxExpression ?? 'license unknown'} — ${f.verdict.toUpperCase()}\n  ${f.rationale}`,
      );
    }
  }

  lines.push('\nLimits: ' + result.limitations.join(' '));
  lines.push('\n' + DISCLAIMER);

  return textResult(lines.join('\n'), {
    ecosystem: result.ecosystem,
    distributionModel: result.distributionModel,
    summary: result.summary,
    findings: result.findings,
    limitations: result.limitations,
  });
}

function explainLicense(args: Record<string, unknown>): ToolResult {
  const license = str(args['license']);
  const linkage = (str(args['linkage']) ?? 'dynamic') as Linkage;

  if (!license) return errorResult('license is required.');

  const rows = verdictMatrix(license, 'runtime', linkage);
  const dev = verdictMatrix(license, 'dev', linkage)[0]!;
  const known = findLicense(license);

  const lines = [`${license} — what it requires, by how you ship:`];
  for (const r of rows) {
    lines.push(`\n- ${r.model}: ${r.verdict.toUpperCase()}\n  ${r.rationale}`);
  }
  lines.push(`\n- as a dev/build-only dependency: ${dev.verdict.toUpperCase()}\n  ${dev.rationale}`);

  if (known) {
    lines.push(`\nAbout this license: ${known.summary}`);
    lines.push(`Reference: ${SITE_ORIGIN}/license/${encodeURIComponent(known.id)}`);
  }
  lines.push('\n' + DISCLAIMER);

  return textResult(lines.join('\n'), {
    license,
    linkage,
    byDistributionModel: rows,
    devScope: { verdict: dev.verdict, rationale: dev.rationale },
  });
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case 'check_dependency_license':
      return checkDependency(args, ctx);
    case 'check_manifest_licenses':
      return checkManifest(args, ctx);
    case 'explain_license':
      return explainLicense(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
