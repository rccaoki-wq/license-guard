import { detectAndParse } from './manifests';
import { LicenseResolver, defaultFetchers } from './resolver';
import type { CacheLike, Fetchers } from './resolver';
import { evaluateExpression } from './policy/engine';
import type {
  DistributionModel,
  Ecosystem,
  Finding,
  Linkage,
  PolicyResult,
  ScanResult,
  ScanSummary,
} from './types';

/**
 * エコシステムごとのリンク形態の既定値。
 * インタプリタ言語は動的、コンパイル言語は静的として扱う。
 */
const DEFAULT_LINKAGE: Record<Ecosystem, Linkage> = {
  npm: 'dynamic',
  pypi: 'dynamic',
  go: 'static',
};

/**
 * ライセンスを特定できなかった場合の判定。
 *
 * 「宣言が存在しない」と「上流から取得できなかった」は法的に全く異なる。
 * 解決失敗を前者と断定すると偽陽性になり、警告全体の信頼を損なうため
 * review に倒し、断定を避けた文言を用いる。
 */
const UNRESOLVED_RESULT: PolicyResult = {
  verdict: 'review',
  obligations: [],
  rationale:
    'The license could not be determined. Either none is declared, or the upstream registry did not return one. A work genuinely published without a license is all rights reserved by default, so the original source needs to be checked.',
};

/**
 * 最新版に落として判定した場合、その事実を理由文に必ず付す。
 * 固定版の結論として最新版の条件を黙って提示することは許されない。
 */
export function withProvenanceNote(
  result: PolicyResult,
  resolvedFrom: Finding['resolvedFrom'],
): PolicyResult {
  if (resolvedFrom !== 'registry-latest') return result;
  return {
    ...result,
    rationale: `${result.rationale} Note: the pinned version declares no license of its own, or was never published, so this reflects the latest release. Verify against the repository for the version you actually use.`,
  };
}

function summarize(findings: Finding[]): ScanSummary {
  return {
    total: findings.length,
    allowed: findings.filter((f) => f.verdict === 'allowed').length,
    review: findings.filter((f) => f.verdict === 'review').length,
    blocked: findings.filter((f) => f.verdict === 'blocked').length,
  };
}

function limitationsFor(ecosystem: Ecosystem, findings: Finding[]): string[] {
  const out = [
    'Only direct dependencies were checked. Transitive dependencies are not included.',
    'Results are based on license metadata declared in the manifest. Code copied into your own source files is not detected.',
  ];

  if (ecosystem === 'go') {
    out.push('Go modules were evaluated assuming static linking.');
  }

  // 再ライセンス（Grafana の Apache-2.0 から AGPL-3.0 など）は実際に起きるので、
  // 最新版で判定したものがあることを黙っておくのは不誠実になる。
  if (findings.some((f) => f.resolvedFrom === 'registry-latest')) {
    out.push(
      'Some dependencies were resolved against the latest release because the pinned version declared no license of its own, or was never published. Those entries are marked. Licenses do change between versions.',
    );
  }

  return out;
}

/**
 * マニフェストの内容を解析し、ライセンス判定結果を返す。
 */
export async function scan(
  content: string,
  distributionModel: DistributionModel,
  cache: CacheLike,
  fetchers: Fetchers = defaultFetchers,
): Promise<ScanResult> {
  const parsed = detectAndParse(content);
  const resolver = new LicenseResolver(cache, fetchers);
  const resolutions = await resolver.resolveAll(parsed.dependencies);
  const linkage = DEFAULT_LINKAGE[parsed.ecosystem];

  const findings: Finding[] = parsed.dependencies.map((dep, i) => {
    const res = resolutions[i]!;
    const policy =
      res.resolvedFrom === 'unresolved'
        ? UNRESOLVED_RESULT
        : withProvenanceNote(
            evaluateExpression(res.spdx, {
              scope: dep.scope,
              linkage,
              distributionModel,
            }),
            res.resolvedFrom,
          );

    return {
      ...dep,
      spdxExpression: res.spdx,
      resolvedFrom: res.resolvedFrom,
      verdict: policy.verdict,
      obligations: policy.obligations,
      rationale: policy.rationale,
    };
  });

  // 重い判定を上に出す
  const order = { blocked: 0, review: 1, allowed: 2 } as const;
  findings.sort((a, b) => order[a.verdict] - order[b.verdict]);

  return {
    ecosystem: parsed.ecosystem,
    distributionModel,
    findings,
    summary: summarize(findings),
    limitations: limitationsFor(parsed.ecosystem, findings),
  };
}
