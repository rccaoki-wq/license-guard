import { detectAndParse, LOCKFILE_NAME, MAX_LOOKUPS } from './manifests';
import { LicenseResolver, defaultFetchers } from './resolver';
import type { CacheLike, Fetchers } from './resolver';
import { evaluateExpression } from './policy/engine';
import type {
  Dependency,
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
  rubygems: 'dynamic',
  nuget: 'dynamic',
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

/**
 * 公開レジストリに存在しないと分かっている依存の判定。
 *
 * 上限に当たった `not-checked` とは別物で、「もう一度スキャンすれば
 * 解決する」は嘘になる。引く先が無いのだから、次も同じ結果になる。
 * 何を見に行けばよいかを名指しする方が実際に役に立つ。
 *
 * 判定は review に倒す。自分のワークスペースメンバーを blocked にすると
 * 警告全体の信頼を落とすが、allowed にすると未確認を「問題なし」と
 * 数えることになり、これは絶対に避ける。
 */
/**
 * 「照会する先が公開レジストリではない」と言うには、**その系の公開
 * レジストリの名前**が要る。ここは crates.io 決め打ちで、Cargo から
 * 移植したときにそのまま残っていた。私設 gem サーバや社内の NuGet
 * フィードを使っている利用者に「crates.io 以外から来ています」と
 * 返っていた——Rust を一行も書いていない人に。
 */
const PUBLIC_REGISTRY: Record<Ecosystem, string> = {
  npm: 'the public npm registry',
  pypi: 'PyPI',
  go: 'the public Go module proxy',
  cargo: 'crates.io',
  rubygems: 'RubyGems.org',
  nuget: 'nuget.org',
};

function notPublishedResult(
  origin: NonNullable<Dependency['origin']>,
  ecosystem: Ecosystem,
): PolicyResult {
  const detail =
    origin === 'workspace'
      ? 'This is a workspace member of the project itself — it has no entry in the lockfile pointing at a registry, so there is nothing to look up. Its license is whatever your own repository states.'
      : origin === 'git'
      ? 'This is a git dependency. The lockfile pins it to a repository and revision, not to a published release, so no registry has license metadata for it. Check the LICENSE file at that revision.'
      : `This comes from a registry other than ${PUBLIC_REGISTRY[ecosystem]}, which this scan does not query. Check the license with whoever operates that registry.`;
  return { verdict: 'review', obligations: [], rationale: detail };
}

/**
 * ライセンスが**本文ファイルとして同梱**されており、識別子の宣言が無い。
 *
 * `UNRESOLVED_RESULT` を当ててはいけない。あちらは「どこにも宣言が無いか、
 * 上流が返さなかった」と書いてあるが、ここでは宣言はある——機械が読めない
 * 形で置いてあるだけで、パッケージを開けば読める。
 *
 * **条件の中身は言わない。** `type="file"` は非標準の条件を意味しない。
 * 実測では MIT の本文をそのまま同梱している発行者もいた
 * （Microsoft.NET.Workload.*）。一方で、最近有償の商用条件へ移った
 * .NET のパッケージ（AutoMapper、FluentAssertions、MediatR）も同じ形を
 * 取る。**どちらかは実物を見ないと分からない**ので、見に行く先だけを示す。
 */
const LICENSE_FILE_RESULT: PolicyResult = {
  verdict: 'review',
  obligations: [],
  rationale:
    'The publisher ships the license as a text file inside the package instead of declaring an SPDX identifier, so it cannot be read automatically. This says nothing about the terms — some packages bundle a standard open-source license this way, others use paid commercial terms. Open the package and read the bundled license file.',
};

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

  /**
   * 件数と動詞を揃える。「1 dependencies are」は、書いてある内容まで
   * 雑に見せる。ここは不完全なスキャンの理由を伝える最後の一文なので、
   * 信頼を削る書き方をしない
   */
  const count = (n: number, singular: string, plural: string) =>
    n === 1 ? `1 dependency ${singular}` : `${n} dependencies ${plural}`;

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
      `${count(notChecked, 'was', 'were')} not checked because this scan reached its lookup limit. They are listed as needing review, not as clear. Scanning again will cover more of them, since each scan warms a shared cache.`,
    );
  }

  // 「もう一度スキャンすれば解決する」が効かない唯一の分類なので、
  // not-checked と一緒くたにせず、別の文で理由を言う。
  // **エコシステムの語を入れない。** yarn workspaces のメンバーも
  // package-lock の git 依存も同じ文を読む
  const notPublished = findings.filter((f) => f.resolvedFrom === 'not-published').length;
  if (notPublished > 0) {
    out.push(
      `${count(notPublished, 'is', 'are')} not published on a public registry — git dependencies, members of the workspace being scanned, or packages from a private registry. No registry has license data for them, so they are listed as needing review. Scanning again will not change that; the licenses have to come from the sources themselves.`,
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

  // 公開レジストリに無いと分かっている依存は照会しない。空振りが確定して
  // いるうえ、失敗は仕様上キャッシュしないので毎回タイムアウトまで待ち直し、
  // 解決できる依存から時間と枠を奪う（実測: zed の未解決 554 件のうち約 190 件）
  const unpublished = (d: Dependency): NonNullable<Dependency['origin']> | null =>
    d.origin !== undefined && d.origin !== 'registry' && !d.declaredLicense ? d.origin : null;

  // 上限は「解析した依存の数」ではなく「実際に上流へ問い合わせる数」に掛ける。
  // 共有キャッシュが育つほど、大きなロックファイルでも照会は要らなくなる。
  const cached = cache.getMany ? await cache.getMany(parsed.dependencies) : new Map();

  // 上限を超えた分は照会せず、未確認として明示する。
  // 費用の上限は保ったまま、確認できた分の価値は返す。
  const needsLookup = (d: Dependency) =>
    !d.declaredLicense &&
    unpublished(d) === null &&
    !(d.version && cached.has(`${d.ecosystem}|${d.name}|${d.version}`));

  let budget = MAX_LOOKUPS;
  const toResolve: typeof parsed.dependencies = [];
  const skipped = new Map<number, 'not-checked' | NonNullable<Dependency['origin']>>();

  parsed.dependencies.forEach((d, i) => {
    const origin = unpublished(d);
    if (origin !== null) {
      skipped.set(i, origin);
      return;
    }
    if (needsLookup(d)) {
      if (budget <= 0) {
        skipped.set(i, 'not-checked');
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
    const why = skipped.get(i);
    resolutions.push(
      why === undefined
        ? resolved[cursor++]!
        : why === 'not-checked'
        ? { spdx: null, resolvedFrom: 'not-checked' as const }
        : { spdx: null, resolvedFrom: 'not-published' as const },
    );
  });
  const linkage = DEFAULT_LINKAGE[parsed.ecosystem];

  const findings: Finding[] = parsed.dependencies.map((dep, i) => {
    const res = resolutions[i]!;
    const policy =
      res.resolvedFrom === 'not-checked'
        ? NOT_CHECKED_RESULT
        : res.resolvedFrom === 'not-published'
        ? notPublishedResult(dep.origin ?? 'workspace', parsed.ecosystem)
        : res.resolvedFrom === 'license-file'
        ? LICENSE_FILE_RESULT
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
