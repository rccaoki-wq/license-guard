# LicenseGuard 設計仕様書

- 作成日: 2026-08-19
- ステータス: ドラフト（ユーザーレビュー待ち）
- 作業名: LicenseGuard（正式名未定）

---

## 1. 概要

GitHub リポジトリの依存関係を走査し、OSS ライセンスが利用者のビジネスモデルに対して法的義務を発生させる場合に、Pull Request 上で警告する GitHub App。

既存のライセンスコンプライアンス製品は「判定が深いが商談必須（FOSSA / Black Duck）」か「セルフサーブだが判定が浅い（Snyk）」に二分されており、その交差点に製品が存在しない。本製品はその空白を埋める。

### 解決する課題

SaaS 事業者が AGPL-3.0 の依存を無自覚に導入し、ソース開示義務を負う。あるいは配布型製品に GPL を混入させる。これらは資金調達のデューデリジェンス、大企業との調達審査、M&A、権利者からの通知の各時点で顕在化し、その時点では手遅れになっている。

GPL 違反が契約違反の請求原因になると判示した地裁判例が存在し、*Software Freedom Conservancy v. Vizio* では SFC が自らが著作権を持たないソフトウェアについて第三者受益者としてライセンス遵守を訴訟で追及する権利を主張している。ライセンス違反時に権利が自動終了する条項を持つライセンスもあり、その場合は使用・配布そのものができなくなる。

---

## 2. 差別化の中核

### 2.1 判定層（Policy Engine）

同一ライセンスでも、利用文脈により結論が真逆になる。ここを正しく扱うことが本製品の実体である。

| 使い方 | AGPL-3.0 の帰結 |
|---|---|
| SaaS として外部提供 | 開示義務あり |
| 社内システムでのみ利用 | 義務なし |
| 顧客に納品・配布 | 開示義務あり |
| CLI ツールとして配布 | 開示義務あり |
| devDependency（成果物に含まれない） | 義務なし |

最後の行が決定的である。既存ツールの多くは devDependency と runtime dependency を区別せずに警告を出し、オオカミ少年化して無視される。

### 2.2 差分ベース報告

既存の違反を毎 PR で全件列挙するツールはアンインストールされる。当該 PR が**新たに持ち込んだ**違反のみを PR に出し、既存分はダッシュボードに置く。この方針は変更しない。

### 2.3 課金単位

競合は全てシート課金であり、開発者を増やすほど費用が増える。本製品はリポジトリ数のフラット課金とし、人数無制限とする。10 人チームで Snyk Team $250/月 に対し Team $99/月。

---

## 3. アーキテクチャ

インフラを持たないサーバーレス構成とする。ソロ運用における保守時間の最小化が目的。

```
GitHub PR opened
      ↓ webhook
[Ingest]   Cloudflare Workers (Hono)
      ↓ enqueue
[Queue]    Cloudflare Queues
      ↓
[Scanner]  lockfile を GitHub API で取得（clone しない）
      ↓
[Resolver] 依存グラフ → SPDX ライセンス式に正規化
      ↓
[Policy]   (license × scope × linkage × distribution_model) → 判定
      ↓
[Diff]     base ブランチとの差分を取り、当該 PR が新規に持ち込んだ違反のみ抽出
      ↓
[Report]   Check Run + PR コメント（1 件のみ、更新方式）
```

### 3.1 コンポーネント

| コンポーネント | 責務 | 依存 |
|---|---|---|
| Ingest | GitHub webhook 受信、署名検証、ジョブ投入 | GitHub App 秘密鍵 |
| Scanner | lockfile 取得とパース、依存グラフ構築 | GitHub API |
| Resolver | パッケージ → SPDX ライセンス式の解決 | レジストリ API, ClearlyDefined, License Cache |
| Policy Engine | 判定。純粋関数 | なし（入出力のみ） |
| Diff | base との比較、新規違反の抽出 | Findings ストア |
| Reporter | Check Run / PR コメント生成 | GitHub API |
| Web App | インストール導線、設定、ダッシュボード、無料ツール | — |
| Billing | Stripe 連携、エンタイトルメント管理 | Stripe |

各コンポーネントは独立してテスト可能であること。特に Policy Engine は外部 I/O を持たない純粋関数として実装し、単体で網羅テストできる状態を維持する。

### 3.2 syft を MVP で使わない理由

syft は Go バイナリであり Cloudflare Workers 上で実行できない。L1（依存関係のみ）に限ればロックファイルの自前パースの方が高速かつ完全サーバーレスで動作する。syft と ScanCode Toolkit は L2（ソース実体スキャン）フェーズで投入する。

---

## 4. 使用する OSS

MVP で使用するもの。全て MIT / Apache-2.0 系であり、自社 SaaS に開示義務は発生しない。ライセンス商材がライセンス的に汚れることを避けるため、この制約は厳守する。

| 役割 | OSS | ライセンス |
|---|---|---|
| SPDX ライセンス式のパース | `jslicense/spdx-expression-parse.js` | MIT |
| SPDX 式の充足判定 | `jslicense/spdx-satisfies.js` | MIT |
| 公式ライセンス ID・全文データ | `spdx/license-list-data` | CC-BY-3.0 |
| キュレーション済みライセンス実データ | ClearlyDefined API | Apache-2.0（無料） |
| GitHub API クライアント | `octokit/octokit.js` | MIT |
| Web フレームワーク | `honojs/hono` | MIT |

将来フェーズで使用予定のもの。

| 役割 | OSS | ライセンス | フェーズ |
|---|---|---|---|
| ソース実体スキャン | `aboutcode-org/scancode-toolkit` | Apache-2.0 | L2 |
| SBOM 生成 | `anchore/syft` | Apache-2.0 | L2 |
| 脆弱性スキャン | `google/osv-scanner` | Apache-2.0 | アドオン |

---

## 5. ライセンス解決

信頼度の高い順に多段解決する。

1. **PEP 639 の `license_expression`（PyPI）** — 正式な SPDX 式であり最も信頼できる
2. パッケージ実体の LICENSE ファイル（レジストリの tarball から取得）
3. 構造化された分類（PyPI の trove classifiers など）
4. `license` / `licenses` フィールド（自己申告。最も信用度が低い）
5. ClearlyDefined のキュレーション済みデータ
6. ユーザーによる手動オーバーライド

実装時の実データ検証で、Flask をはじめとする最新の PyPI パッケージが **classifiers を持たず `license_expression` のみを持つ**ことが判明した。PEP 639 への移行が進んでいるため、このフィールドを見ないと主要パッケージを取りこぼす。

### 5.0 上流フェッチのタイムアウト

全ての上流 API 呼び出しに **5 秒のタイムアウト**を設ける。

ClearlyDefined は未ハーベストの座標を初めて要求された際、その場でハーベストを実行するため応答が数分に及ぶことがある（実測で 2 分超）。タイムアウトを設けないと Worker のリクエスト時間を使い切り、スキャン全体が失敗する。上流の遅延は「解決できなかった」として扱い、判定をブロックしない。

### 5.1 キャッシュ

`(ecosystem, package, version)` に対するライセンスは不変であるため、全ユーザー共通でキャッシュする。3 ヶ月運用後のキャッシュヒット率は 95% 超を見込む。

このキャッシュは同時に競争優位の源泉でもある。運用期間に比例してキュレーション済みライセンス DB が厚くなり、後発が追随しにくくなる。

### 5.2 正しく扱う必要があるもの

- デュアルライセンス（MySQL: GPL or 商用、Qt: LGPL or 商用）
- ライセンス例外（GCC Runtime Library Exception、Classpath Exception）
- SPDX 式の論理演算（`(MIT OR Apache-2.0)`、`GPL-2.0-only WITH Classpath-exception-2.0`）

---

## 6. Policy Engine

### 6.1 インターフェース

入力:

- `license_expression`: SPDX 式
- `scope`: `runtime` | `dev` | `build` | `test` | `optional`
- `linkage`: `dynamic` | `static` | `separate-process`
- `distribution_model`: `saas` | `distributed-binary` | `on-prem-delivery` | `internal-only` | `library-published`

出力:

- `verdict`: `allowed` | `review` | `blocked`
- `obligations[]`: `attribution` | `notice-file` | `source-disclosure` | `same-license` | `patent-grant`
- `rationale`: 人間が読める説明（条項引用を含む）
- `alternatives[]`: 代替パッケージ候補

`linkage` は自動判定が困難であるため、インタプリタ言語（npm / PyPI）は `dynamic`、コンパイル言語（Go / Rust）は `static` をデフォルトとし、ユーザーが上書き可能とする。

### 6.2 判定表

| ライセンス | scope | 配布モデル | 判定 |
|---|---|---|---|
| MIT / BSD / ISC | any | any | allowed（表示義務） |
| Apache-2.0 | any | any | allowed（NOTICE 必須・特許条項） |
| GPL-3.0 | runtime | saas | allowed ＋ 警告（配布に転じた場合の義務を明示） |
| GPL-3.0 | runtime | distributed-binary | blocked |
| GPL-3.0 | runtime | on-prem-delivery | blocked |
| AGPL-3.0 | runtime | saas | blocked |
| AGPL-3.0 | runtime | internal-only | allowed |
| AGPL-3.0 / GPL | **dev** | any | **allowed** |
| LGPL | runtime | 動的リンク | allowed（差し替え可能性の保持義務） |
| LGPL | runtime | 静的リンク | review |
| BSL / SSPL / Elastic-2.0 | runtime | saas | review（条項を個別抽出して提示） |
| CC-BY-NC | any | 商用 | blocked |
| **ライセンス表記なし** | runtime | any | **blocked** |

最終行は重要である。ライセンス表記のないパッケージは法的に全権利留保であり、GPL より制約が強い。既存ツールの多くは `UNKNOWN` と表示して素通りさせる。

---

## 7. 対応エコシステム

MVP: npm / PyPI / Go modules。GitHub 上のインディー・スタートアップ層の大半をカバーする。

Fast-follow: Cargo。
その後: Maven / Gradle、NuGet、Composer、RubyGems。

---

## 8. データモデル（骨子）

```
installations   -- GitHub App のインストール単位
  id, github_installation_id, account_login, account_type, created_at

repositories
  id, installation_id, github_repo_id, full_name,
  distribution_model, linkage_default, enabled

license_cache   -- 全ユーザー共通
  ecosystem, package, version, spdx_expression, source, resolved_at
  PRIMARY KEY (ecosystem, package, version)

findings
  id, repository_id, commit_sha, pr_number,
  ecosystem, package, version, scope,
  spdx_expression, verdict, obligations, rationale,
  status,           -- open | overridden | resolved
  first_seen_at, resolved_at

overrides       -- 手動オーバーライド
  id, repository_id, ecosystem, package, version,
  spdx_expression_override, verdict_override, reason, created_by, created_at

entitlements    -- 課金経路を抽象化する層
  id, installation_id, plan, status,
  source,          -- 'stripe' | 'marketplace'
  external_id, current_period_end
```

`entitlements.source` は Phase 1（Stripe のみ）の時点から存在させる。Phase 2 での GitHub Marketplace 追加時に、スキーマ変更なしで合流できるようにするため。

### 8.1 永続化先

Cloudflare D1（SQLite）を使用する。Workers と同一プラットフォーム上に収まり、追加のインフラ運用が発生しないため。

`license_cache` は全ユーザー共通かつ追記のみで、レコードあたり数百バイトに収まる。D1 の容量上限に対して十分な余裕がある。

なお D1 は 1 SQL ステートメントあたり UTF-8 で 100KB の上限を持つため、キャッシュの一括投入時はバッチを分割すること。サイズ計測には `Buffer.byteLength(sql, 'utf8')` を用いる（`String.length` は UTF-16 単位であり過小評価となる）。

### 8.2 `distribution_model` の決定方法

自動推定は行わない。誤推定は判定結果を丸ごと誤らせるため、リスクが利便性を上回る。

- GitHub App のインストール直後、オンボーディング画面で必ず選択させる
- 未設定のリポジトリは `saas` を暫定値とする（最も制約が厳しい一般的ケースであり、偽陰性より偽陽性側に倒すため）
- 暫定値で動作している間、PR コメントの冒頭に「配布モデルが未設定のため SaaS として判定しています」と明示し、設定画面へのリンクを添える
- リポジトリ単位で上書き可能とする（1 つの Org が SaaS と受託納品を併存させるケースに対応するため）

---

## 9. 課金設計

### 9.1 プラン

| プラン | 価格 | 内容 |
|---|---|---|
| Free | $0 | パブリックリポ無制限、README バッジ |
| Pro | $29/月 | プライベートリポ 5 個、PR コメント、Slack 通知 |
| Team | $99/月 | リポ無制限・人数無制限、ポリシーカスタム、監査レポート |
| Business | $299/月 | 複数 Org、SSO、API、優先対応 |
| スポット監査 | $199/回 | 単発の監査レポート PDF |

### 9.2 課金経路の段階導入

**Phase 1: Stripe のみ。**

GitHub Marketplace のプラン形式は Free / Flat rate / Per-unit の 3 種類のみで、いずれもサブスクリプションである。単発購入の形式が存在しないため、$199 のスポット監査レポートは Marketplace では販売できない。Stripe は必須。

**Phase 2: GitHub Marketplace を追加。**

規約上、外部に有料サービスがある場合でも、Marketplace に有料プランを最低 1 つ載せれば無料プランを併置できる。禁止されているのは「Marketplace では無料のみ、課金は自社サイトのみ」の構成。

Marketplace 側の制約:

- 無料トライアルは 14 日固定。変更不可
- トライアル終了時、解約しなければ自動で本課金に移行
- 全プランに月額と年額の両方を設定する義務
- 最大 10 プラン、米ドルのみ
- 有料プランには verified publisher 認証が必要（DNS TXT、メール検証、Org 側 2FA 必須）
- 購入・解約イベントのハンドリング必須。有料プラン保有時はトライアル・アップグレード・ダウングレードのイベント処理も必要
- 支払いは月 $500 到達後、翌月末払い
- 手数料 5%

### 9.3 ユニットエコノミクス

- 1 スキャンあたりの変動費: $0.0001 未満（キャッシュ済みレジストリ照会 ＋ Workers 実行）
- 粗利率: 95% 以上
- $10,000 MRR 到達に必要な顧客数: Pro 200 ＋ Team 40 ≈ $9,760
- 初期目標（月 10〜30 万円 = $700〜2,000 MRR）: Pro 25〜70 件

---

## 10. 集客

### 10.1 プログラマティック SEO

製品の副産物として蓄積するライセンス DB から、検索意図に直接対応するページを自動生成する。これが最大の集客資産である。

- パッケージ単位: 「Is `express` safe for commercial use?」
- AGPL 製品単位: 「Can I use Grafana in a commercial SaaS?」
- ライセンス種別単位: 「AGPL vs GPL for SaaS: what's the difference?」
- 移行需要: 「MongoDB SSPL alternatives」

数万ページが製品構築の副産物として得られ、かつ検索者は当該課題に直面している最中であるためコンバージョン率が高い。

### 10.2 無料 Web ツール

サインアップ不要で `package.json` / `requirements.txt` / `go.mod` を貼ると即座にレポートが出る。トップオブファネルとして機能し、GitHub App 導線へ接続する。

### 10.3 README バッジ

パブリックリポの無料スキャンにより、OSS メンテナがバッジを貼る。露出が複利で増加する。広告費ゼロ。

### 10.4 その他

Show HN、r/opensource、r/devops、GitHub Marketplace リスティング（Phase 2）。

---

## 11. 法的リスクと対策

露出は「助言」と「情報」の境界に発生する。FOSSA も Black Duck も自社製品を一貫して「自動化・情報提供」と位置づけ、「法的助言」とは表現しない。同じ方針を設計に埋め込む。

- **出力は事実の提示に限定する。** 「このライセンスは使うべきではない」ではなく「AGPL-3.0 第 13 条は、ネットワーク経由で利用させる場合に対応するソースの提供を要求している」と記述する。条項を引用し、判断は下さない
- 全出力・全レポート・ToS に「これは法的助言ではなく、弁護士・依頼者関係を構成しない」を固定表示
- ToS: as-is、無保証、責任上限は支払済み料金額
- 判定不能時は `blocked` ではなく `review` に倒す
- 手動オーバーライドを常時提供
- 網羅性を主張しない。「全ての違反を検出する」ではなく「依存マニフェストに宣言されたライセンスを検出する」と限定する
- 収益が正当化できる段階で E&O 保険を検討

---

## 12. テスト戦略

Policy Engine は純粋関数であるため、検証をここに集中させる。

- 判定表の全組み合わせに対するテーブルテスト
- SPDX 式評価のゴールデンテスト（`(MIT OR Apache-2.0)`、`GPL-2.0-only WITH Classpath-exception-2.0` 等）
- 既知のライセンス状況を持つフィクスチャリポジトリ 50 件でのベンチマーク
- 偽陽性率 5% 未満を出荷条件とする
- Resolver は各レジストリのレスポンスをフィクスチャ化して契約テスト

---

## 13. エラーハンドリング

| 事象 | 挙動 |
|---|---|
| レジストリ到達不可・タイムアウト | `review`。ブロックしない |
| 未知のライセンス文字列 | `review`（`blocked` にしない） |
| ライセンス表記が完全に不在（**積極的な証拠がある場合のみ**） | `blocked`（全権利留保のため） |

最後の 2 行の区別は重要である。「宣言が存在しないことを確認した」と「上流から取得できなかった」は法的に全く異なるため、後者を前者と断定してはならない。Phase 0 の時点ではレジストリのメタデータからこの 2 つを確実に区別できないため、**解決失敗は一律 `review`** とし、理由文でも「特定できませんでした。宣言が存在しないか、取得できなかったかのいずれかです」と断定を避ける。積極的な証拠（LICENSE ファイルの不在確認）が得られる Phase 1 以降で `blocked` を適用する。
| GitHub API レート制限 | 指数バックオフ ＋ キャッシュ |
| lockfile パース失敗 | 該当エコシステムのみスキップし、他は続行。PR コメントに明示 |
| PR コメント投稿失敗 | Check Run のみで結果を提示 |

PR コメントは 1 リポジトリ・1 PR につき 1 件のみとし、再スキャン時は新規投稿でなく更新する。

---

## 14. 進め方

支払意思の検証を実装に先行させる。

### Phase 0: 検証（1〜2 週間）

無料 Web ツールのみを公開する。`package.json` を貼ると結果が出る。「有料の詳細レポートを取得」ボタンを設置し、クリック率で支払意思を測定する。この段階では有料レポートは実装しない。

同時に SEO 資産の土台を構築する。

**判断基準**: クリック率が有意に立たない場合、想定顧客（インディー開発者）が誤っている可能性を示す。その場合は買い手仮説を「資金調達準備中の CTO / 受託開発会社 / 上場準備企業」に切り替え、スポット監査レポートを先行させる。

### Phase 1: MVP（GitHub App）

Phase 0 で支払意思が確認できた場合に着手する。

### Phase 2: Marketplace 追加・L2 スキャン・エコシステム拡張

---

## 15. MVP に含めないもの

L2 ソーススキャン、PDF 監査レポート、Slack 通知、自動修正 PR、SBOM エクスポート、Maven / NuGet / Composer / RubyGems、GitHub Marketplace 課金。

---

## 16. Done 定義

### Phase 0

- [ ] 無料 Web ツールが npm / PyPI / Go のマニフェストを受け付け、ライセンス判定結果を表示する
- [ ] 「有料レポート取得」ボタンのクリック率が計測できる
- [ ] 判定結果が「法的助言ではない」旨を明示している
- [ ] 1〜2 週間の計測データが取得できている

### Phase 1

- [ ] npm / PyPI / Go の 3 エコシステムで PR コメントが動作する
- [ ] dev / runtime を正しく区別し、devDependency の AGPL を警告しない
- [ ] 差分ベース報告が動作し、既存違反を PR に出さない
- [ ] `distribution_model` の設定により判定が変化する
- [ ] フィクスチャ 50 件で偽陽性率 5% 未満
- [ ] 手動オーバーライドが機能する
- [ ] Stripe 課金が通り、`entitlements` にプランが反映される
- [ ] パブリックリポは無料で無制限に動作する

---

## 17. 主要リスク

| リスク | 確率 | 影響 | 対策 |
|---|---|---|---|
| インディー開発者に支払意思がない（痛みが潜在的） | **高** | 致命的 | Phase 0 で検証。買い手仮説の切替を準備 |
| GitHub が Dependency Graph に統合 | 中〜高 | 大 | 判定層と監査レポートに価値を寄せる。ビジネスモデル別判定は Microsoft が法的露出を避けて実装しないと想定 |
| 個人開発者による模倣 | 高 | 中 | ライセンス DB の蓄積と SEO ページの複利。先行期間が堀 |
| FOSSA のセルフサーブ参入 | 中 | 大 | エンタープライズ営業組織はセルフサーブの実行が不得手。先行して SEO 資産を積む |
| 偽陽性による信頼失墜 | 中 | 大 | 判定不能時は `review`。手動オーバーライド常設。偽陽性率 5% を出荷条件化 |
| 法的助言と誤認される | 低 | 大 | 条項引用型の出力。免責の固定表示。網羅性を主張しない |

---

## 18. 未決事項

- 正式なプロダクト名とドメイン
- 代替パッケージ推奨 DB の初期データをどう作るか（手動キュレーションで主要 AGPL/BSL 製品 30 件程度から始めるのが現実的か）
- Phase 0 のクリック率の合格ラインを何 % に置くか
