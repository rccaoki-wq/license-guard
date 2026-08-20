# LicenseGuard

*[English](README.md) | 日本語*

依存 OSS のライセンスが、あなたの**配布モデル**に対して法的義務を発生させるかを判定するツール。

本番: https://license-guard.rcc-aoki.workers.dev

## 何が違うのか

既存のライセンスコンプライアンス製品は「判定が深いが商談必須（FOSSA / Black Duck）」か「セルフサーブだが判定が浅い（Snyk）」に二分され、その交差点に製品が存在しない。

差別化の中核は**判定層**にある。同じライセンスでも文脈で結論が真逆になる。

| 使い方 | AGPL-3.0 の帰結 |
|---|---|
| SaaS として外部提供 | 開示義務あり（第13条） |
| 社内システムでのみ利用 | 義務なし |
| 顧客に納品・配布 | 開示義務あり（GPL 由来の配布条項） |
| **devDependency**（成果物に含まれない） | **義務なし** |

最後の行が決定的。既存ツールの多くは dev と runtime を区別せず警告を出し、オオカミ少年化して無視される。

## エージェントから使う

この製品が必要になるのは、ブラウザで検索している時ではなく**依存を追加している時**です。だから第一の配置は検索結果ではなく、エージェントのツールです。

ホスト版（すぐ使える）:

```bash
claude mcp add licenseguard --transport http https://license-guard.rcc-aoki.workers.dev/mcp
```

ローカル版（マニフェストを手元から出さない）:

```bash
docker build -t licenseguard .
claude mcp add licenseguard -- docker run -i --rm licenseguard
```

**判定エンジンは両者で同一です。** 違うのは経路だけで、答えが食い違うことはありません
（`npm run e2e:stdio` で固定しています）。

ローカル版は依存関係の一覧を外部に送りません。公開レジストリへ
パッケージ名とバージョンを問い合わせるだけです。コンプライアンスを扱う道具に
ロックファイルを渡したくない場合はこちらを使ってください。

ステートレスな Streamable HTTP、認証不要。提供するツール:

| ツール | 用途 |
|---|---|
| `check_dependency_license` | 依存を1つ追加する前に呼ぶ |
| `check_manifest_licenses` | マニフェスト全体を監査する |
| `explain_license` | ライセンス自体が何を要求するかを全配布モデルで説明する |

JSON API も同じ判定を返します。

```bash
curl "https://license-guard.rcc-aoki.workers.dev/api/pkg/pypi/pyload-ng?model=saas"
# => {"license":"AGPL-3.0-only","verdict":"blocked", ...}
```

エージェント向けの入口は [`/llms.txt`](https://license-guard.rcc-aoki.workers.dev/llms.txt) にまとめてあります。

## 対応形式

対応エコシステム: **npm / PyPI / Go modules / crates.io（Rust）**

| 形式 | 推移的依存 | 外部照会 |
|---|---|---|
| `package-lock.json` | ○ | **不要**（ライセンスを内包） |
| `pnpm-lock.yaml` / `yarn.lock` | ○ | 必要（共有キャッシュで逓減） |
| `go.sum` | ○ | 必要 |
| `Cargo.lock` / `poetry.lock` / `uv.lock` | ○ | 必要 |
| `package.json` / `requirements.txt` / `go.mod` / `Cargo.toml` | ✗ 直接依存のみ | 必要 |

問題のあるライセンスは、直接追加した依存より依存の依存として紛れ込むことの方が多い。
そのためロックファイルを渡す経路が実質的な本命です。とくに `package-lock.json` は
全エントリにライセンスを内包しているため、推移的依存まで**外部照会ゼロ**で判定できます。

```bash
curl -X POST https://license-guard.rcc-aoki.workers.dev/api/scan \
  -H 'content-type: application/json' \
  -d "$(jq -Rs '{content: ., distributionModel: "saas"}' package-lock.json)"
```

**不完全なスキャンが「問題なし」に見えることはありません。** 解決できなかった依存は
`not-checked` または `review` として集計に載ります。`allowed` になることはありません。

## 現在のフェーズ

**Phase 0（支払意思の検証）** — MCP サーバーと無料 Web ツールを公開済み。主戦場は検索ではなくエージェントの workflow なので、検証指標は CTA クリック率ではなく **MCP の導入数と継続呼び出し数**。GitHub App（Phase 1）は検証結果を見てから着手する。

## 開発

```bash
npm install
npm test          # 全テスト
npm run typecheck
npm run coverage
npm run smoke     # 実レジストリへの疎通確認
npm run e2e       # 本番に対する E2E
                  #   ui          Playwright で実ブラウザ
                  #   a11y        アクセシビリティ
                  #   mcp         公式 MCP SDK クライアント
                  #   load        並列実行時の一貫性
                  #   adversarial 敵対的入力・境界値
                  #   correctness 既知の正解との突き合わせ
                  #   operational 経路間の一致・HTTP・キャッシュ
                  #   stdio       ローカル版とホスト版の判定一致
npm run dev       # http://localhost:8787
npm run signals   # Phase 0 の判断材料。実利用だけに絞って出す
```

`npm run signals` は次の一手を決める数字を出すので、意図的に厳しく倒してある。
合成トラフィック（E2E は全て `x-licenseguard-synthetic: 1` を送る）、レジストリの
巡回ボット、帰属の仕組みを入れる前の行は、黙って捨てずに別枠で報告したうえで
集計から外す。**帰属できないものは需要として数えない。**

ユニットテストが全て通っていても、実データを流すまで見つからない欠陥がある。
`smoke` と `e2e` は本番相当の外部依存に対して実行するため、リリース前に必ず通すこと。

デプロイ:

```bash
npm run db:migrate
npm run deploy
```

## ドキュメント

- 設計仕様書: [docs/specs/2026-08-19-license-guard-design.md](docs/specs/2026-08-19-license-guard-design.md)
- Phase 0 実装計画: [docs/superpowers/plans/2026-08-19-phase0-free-web-tool.md](docs/superpowers/plans/2026-08-19-phase0-free-web-tool.md)
- レジストリ登録手順: [docs/PUBLISHING.md](docs/PUBLISHING.md)

## 依存 OSS

本製品自身が扱う題材の性質上、依存はすべて MIT / Apache-2.0 系に限定している。自社 SaaS に開示義務は発生しない。

| 役割 | OSS | ライセンス |
|---|---|---|
| SPDX 式のパース | `spdx-expression-parse` | MIT |
| Web フレームワーク | `hono` | MIT |
| Go のライセンスデータ | ClearlyDefined API | Apache-2.0 |

## 免責

本ツールが提示するのは、公開されたライセンス条文と依存マニフェストに基づく**情報**であり、法的助言ではない。利用によって弁護士・依頼者関係は成立しない。判定はマニフェストに宣言されたライセンス情報に基づくものであり、全ての義務や違反を網羅するものではない。

## ライセンス

Apache-2.0
