import { detectAndParse, LOCKFILE_NAME, MAX_LOOKUPS } from './manifests';
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
  // Go と Rust は既定で静的リンクされる
  go: 'static',
  cargo: 'static',
};

/**
 * ライセンスを特定できなかった場合の判定。
 *
 * 「宣言が存在しない」と「上流から取得できなかった」は法的に全く異なる。
 * 解決失敗を前者と断定すると偽陽性になり、警告全体の信頼を損なうため
 * review に倒し、断定を避けた文言を用いる。
 */
/**
 * 照会の上限に達して確認しなかった依存の判定。
 *
 * 拒否して何も返さないより、確認できた分を返す方が有用。ただし
 * 不完全なスキャンが「問題なし」に見えることは絶対に避ける必要がある。
 * 人は要約を流し読みするので、未確認分は review として集計に載せ、
 * 合計が clean にならないようにする。
 */
const NOT_CHECKED_RESULT: PolicyResult = {
  verdict: 'review',
  obligations: [],
  rationale:
    'This dependency was not checked. The scan reached its limit on how much one request may look up. Scanning the same project again will cover more of it, because each scan adds what it resolved to a cache shared by everyone.',
};

/**
 * 1 リクエストが上流の照会に使ってよい実時間。
 *
 * 件数の上限だけでは足りない。実物の go.sum（約390モジュール）で
 * 3 分待っても応答が返らなかった。Go は「版一覧 → 候補ごとの
 * ClearlyDefined」で 1 依存に複数回タイムアウトを踏みうるため、
 * 直列バッチの合計はどこまでも伸びる。**返らないページは、
 * 不完全なページよりはるかに悪い。**
 */
export const SCAN_BUDGET_MS = 20_000;

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
    rationale: `${result.rationale} Note: this license was not read from the exact version requested — that version declares none of its own, was never published, or has no curated license data. It reflects another release of the same package. Verify against the repository for the version you actually use.`,
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

function limitationsFor(ecosystem: Ecosystem, findings: Finding[], transitive: boolean): string[] {
  // 推移的依存まで見えたかは**どのパーサを通ったか**でしか決まらない。
  // かつて Finding の `resolvedFrom` で判定しており、npm はロックファイルに
  // ライセンスを書かないため常に false になって、ロックファイルを貼った人に
  // 「ロックファイルを貼れ」と返していた。助言するファイル名もエコシステムに
  // 合わせる（requirements.txt の利用者に package-lock.json を勧めない）
  const out = transitive
    ? [
        'Transitive dependencies are included, read from the lockfile with the exact versions that will be installed.',
        'Results are based on license metadata recorded in the lockfile. Code copied into your own source files is not detected.',
      ]
    : [
        `Only direct dependencies were checked. Transitive dependencies are not included — send a ${LOCKFILE_NAME[ecosystem]} to cover those.`,
        'Results are based on license metadata declared in the manifest. Code copied into your own source files is not detected.',
      ];

  if (ecosystem === 'go' || ecosystem === 'cargo') {
    const label = ecosystem === 'go' ? 'Go modules' : 'Rust crates';
    out.push(`${label} were evaluated assuming static linking.`);
  }

  // 再ライセンス（Grafana の Apache-2.0 から AGPL-3.0 など）は実際に起きるので、
  // 最新版で判定したものがあることを黙っておくのは不誠実になる。
  const notChecked = findings.filter((f) => f.resolvedFrom === 'not-checked').length;
  if (notChecked > 0) {
    out.unshift(
      // 打ち切りの理由は件数上限と時間切れの両方がありうる。片方だけを
      // 名指しすると、もう片方のときに嘘になる
      `${notChecked} dependencies were not checked because this scan reached its lookup limit. They are listed as needing review, not as clear. Scanning again will cover more of them, since each scan warms a shared cache.`,
    );
  }

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
  budgetMs: number = SCAN_BUDGET_MS,
): Promise<ScanResult> {
  const deadline = Date.now() + budgetMs;
  const parsed = detectAndParse(content);

  // 上限は「解析した依存の数」ではなく「実際に上流へ問い合わせる数」に掛ける。
  // 共有キャッシュが育つほど、大きなロックファイルでも照会は要らなくなる。
  const cached = cache.getMany ? await cache.getMany(parsed.dependencies) : new Map();
  const lookups = parsed.dependencies.filter(
    (d) => !d.declaredLicense && !(d.version && cached.has(`${d.ecosystem}|${d.name}|${d.version}`)),
  ).length;

  // 上限を超えた分は照会せず、未確認として明示する。
  // 費用の上限は保ったまま、確認できた分の価値は返す。
  const needsLookup = (d: (typeof parsed.dependencies)[number]) =>
    !d.declaredLicense && !(d.version && cached.has(`${d.ecosystem}|${d.name}|${d.version}`));

  let budget = MAX_LOOKUPS;
  const toResolve: typeof parsed.dependencies = [];
  const skipped = new Set<number>();

  parsed.dependencies.forEach((d, i) => {
    if (needsLookup(d)) {
      if (budget <= 0) {
        skipped.add(i);
        return;
      }
      budget -= 1;
    }
    toResolve.push(d);
  });

  const resolver = new LicenseResolver(cache, fetchers);
  // 費用の見積もりで既に引いてある。渡さないと resolve() が
  // 1 件ずつ D1 を引き直し、ヒットしている分がまるごと往復になる
  const resolved = await resolver.resolveAll(toResolve, deadline, cached);

  // 元の並び順に戻す
  const resolutions: Array<(typeof resolved)[number]> = [];
  let cursor = 0;
  parsed.dependencies.forEach((_, i) => {
    resolutions.push(
      skipped.has(i)
        ? { spdx: null, resolvedFrom: 'not-checked' as const }
        : resolved[cursor++]!,
    );
  });
  const linkage = DEFAULT_LINKAGE[parsed.ecosystem];

  const findings: Finding[] = parsed.dependencies.map((dep, i) => {
    const res = resolutions[i]!;
    const policy =
      res.resolvedFrom === 'not-checked'
        ? NOT_CHECKED_RESULT
        : res.resolvedFrom === 'unresolved'
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
    limitations: limitationsFor(parsed.ecosystem, findings, parsed.transitive),
  };
}
