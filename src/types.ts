/**
 * 実行時に文字列を Ecosystem として受け取ってよいか確かめるための一覧。
 * 型は消えるので、外から来た値（経路の一部、DB の列、MCP の引数）には
 * 必ずこれを通す。
 *
 * **union をここから導く**——逆ではない。以前は union が定義で、この配列は
 * `readonly Ecosystem[]` と注釈した手書きの写しだった。その向きだと、
 * union に足しても配列が古いままでも型が通る。実際 rubygems を足したとき、
 * MCP のツールスキーマは `['npm','pypi','go','cargo']` のまま出荷され、
 * Ruby の利用者は MCP 経由だと入口で弾かれていた。
 *
 * 配列を源にすれば、写しは存在しえない。
 */
export const ECOSYSTEMS = ['npm', 'pypi', 'go', 'cargo', 'rubygems', 'nuget'] as const;

export type Ecosystem = (typeof ECOSYSTEMS)[number];

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
  | 'no-derivatives'
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
  /**
   * 宣言が版を欠いていたため、こちらで補ったことを表す。
   *
   * `rationale` は補った後の識別子で書かれる（"LGPL-3.0-only requires ..."）。
   * それ自体は宣言に無い版なので、**補ったという事実を別に持たせる**。
   * 文章に混ぜると 5 行の表で 5 回繰り返され、定型文として読み飛ばされる。
   */
  assumption?: { declared: string; assumed: string };
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
  /**
   * リポジトリ直下の LICENSE ファイルそのもの。版を指定しない問いにだけ使う。
   * 上流のスキャン結果と違って一次資料だが、既定ブランチの現在の内容なので
   * 特定の版の答えではない。
   */
  | 'repo-license'
  /** 照会の上限に達したため確認していない。allowed と混同してはならない */
  | 'not-checked'
  /**
   * 公開レジストリに存在しないと分かっているため照会していない。
   * git 依存・ワークスペースメンバー・私設レジストリ。
   * `not-checked` とは別物 —— 上限に当たったのではなく、引く先が無い。
   */
  | 'not-published'
  /**
   * 発行者がライセンスを**本文ファイルとして同梱**しており、SPDX の識別子を
   * 宣言していない（NuGet の `<license type="file">`）。
   *
   * `unresolved` と混ぜてはいけない。あちらの文言は「どこにも宣言が無いか、
   * レジストリが返さなかった」で、この場合は**宣言はある**——機械では
   * 読めない形で置いてあるだけ。混ぜると、実物を見れば分かる依存に対して
   * 「上流が答えなかった」という嘘の説明が付く。
   *
   * 意味までは言えない。type="file" は非標準の条件とは限らず、実測では
   * MIT の本文をそのまま同梱している発行者もいた（Microsoft.NET.Sdk.*）。
   * 主張してよいのは「読めない形で宣言されている」という事実だけ。
   */
  | 'license-file'
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
