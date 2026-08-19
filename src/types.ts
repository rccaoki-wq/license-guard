export type Ecosystem = 'npm' | 'pypi' | 'go';

export type Scope = 'runtime' | 'dev' | 'build' | 'test' | 'optional';

export type Linkage = 'dynamic' | 'static' | 'separate-process';

export type DistributionModel =
  | 'saas'
  | 'distributed-binary'
  | 'on-prem-delivery'
  | 'internal-only'
  | 'library-published';

export type Verdict = 'allowed' | 'review' | 'blocked';

export type Obligation =
  | 'attribution'
  | 'notice-file'
  | 'source-disclosure'
  | 'same-license'
  | 'patent-grant';

export type LicenseCategory =
  | 'public-domain'
  | 'permissive'
  | 'weak-copyleft'
  | 'strong-copyleft'
  | 'network-copyleft'
  | 'source-available'
  | 'non-commercial'
  | 'unknown'
  | 'none';

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  /** 具体的なバージョン。範囲指定などで確定できない場合は null */
  version: string | null;
  scope: Scope;
}

export interface PolicyContext {
  scope: Scope;
  linkage: Linkage;
  distributionModel: DistributionModel;
}

export interface PolicyResult {
  verdict: Verdict;
  obligations: Obligation[];
  /** 条項を引用した事実ベースの説明。法的助言の表現を含めないこと */
  rationale: string;
}

export type ResolvedFrom = 'registry' | 'clearlydefined' | 'cache' | 'unresolved';

export interface Finding extends Dependency {
  spdxExpression: string | null;
  resolvedFrom: ResolvedFrom;
  verdict: Verdict;
  obligations: Obligation[];
  rationale: string;
}

export interface ScanSummary {
  total: number;
  allowed: number;
  review: number;
  blocked: number;
}

export interface ScanResult {
  ecosystem: Ecosystem;
  distributionModel: DistributionModel;
  findings: Finding[];
  summary: ScanSummary;
  /** 「直接依存のみ」等、結果の限界をユーザーに伝える文言 */
  limitations: string[];
}
