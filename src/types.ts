export type Ecosystem = 'npm' | 'pypi' | 'go' | 'cargo';

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
  | 'file-copyleft'
  | 'library-copyleft'
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
  /**
   * ロックファイルに記録されていたライセンス。
   * 存在する場合は上流への照会が不要で、かつ実際に導入される版の情報。
   */
  declaredLicense?: string;
  /**
   * その依存がどこから来るか。**公開レジストリを引く意味があるかを決める。**
   *
   * ロックファイルによっては出所が書いてある（Cargo.lock の `source` 行）。
   * git 依存・ワークスペースメンバー・私設レジストリの名前は crates.io に
   * 存在しないので、照会すれば必ず空振りする。失敗は仕様上キャッシュ
   * しない（内部パッケージ名を保存しないため）ので、毎回タイムアウトまで
   * 待ち直し、解決できるはずの依存から予算を奪う。実測: zed の未解決
   * 554 件のうち約 190 件がこれだった。
   *
   * 書いていないロックファイル形式では undefined。**推測しない** ——
   * 「無いから内部」と決めつけると、解決できる依存を照会しなくなる。
   */
  origin?: 'registry' | 'workspace' | 'git' | 'other-registry';
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

/**
 * ライセンス情報の出所。
 * 'registry-latest' は、固定されたバージョン自身が情報を持たなかった
 * （または未公開だった）ため最新リリースから採ったことを表す。
 */
export type ResolvedFrom =
  /** ロックファイルに記録されていた値。実際に導入される版の情報で最も確か */
  | 'lockfile'
  | 'registry'
  | 'registry-latest'
  /** deps.dev (Google Open Source Insights)。Go の主たる出典 */
  | 'deps-dev'
  | 'clearlydefined'
  /** 照会の上限に達したため確認していない。allowed と混同してはならない */
  | 'not-checked'
  /**
   * 公開レジストリに存在しないと分かっているため照会していない。
   * git 依存・ワークスペースメンバー・私設レジストリ。
   * `not-checked` とは別物 —— 上限に当たったのではなく、引く先が無い。
   */
  | 'not-published'
  | 'unresolved';

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
