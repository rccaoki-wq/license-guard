# LicenseGuard

*[English](README.md) | 日本語*

[![Glama quality](https://glama.ai/mcp/servers/rccaoki-wq/license-guard/badges/score.svg)](https://glama.ai/mcp/servers/rccaoki-wq/license-guard)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.rccaoki--wq%2Flicense--guard-0a7c3f)](https://registry.modelcontextprotocol.io/v0/servers?search=license-guard)
[![License](https://img.shields.io/badge/license-Apache--2.0-1a5fd0)](LICENSE)

[mcpservers.org](https://mcpservers.org/servers/rccaoki-wq/license-guard)、[Smithery](https://smithery.ai/servers/rcc-aoki/license-guard)、[TensorBlock MCP Index](https://www.tensorblock.co/mcp/servers/github-rccaoki-wq-license-guard-1818e624)、[Docker MCP カタログ](https://github.com/docker/mcp-registry) にも掲載。

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
claude mcp add licenseguard -- docker run -i --rm ghcr.io/rccaoki-wq/license-guard:1.1.0
```

イメージはリリースごとに公開され、公式 MCP レジストリに OCI パッケージとして宣言してある。
レジストリを読むクライアントなら、この手順すら要らずに導入できる。
自分でビルドする場合は `docker build -t licenseguard . && docker run -i --rm licenseguard`。

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

1回のスキャンで上流に問い合わせるのは最大300件。1リクエストの費用を有界にするための上限です。
キャッシュ済みのものはこの枠を消費しないので、効くのは**まだ誰も引いていない**名前だけ。
1000クレート規模の `Cargo.lock` を初めて投げると数十〜百件ほどが `not-checked` で残り、
もう一度投げると解決します（実測: servo 1043件が2回目で公開クレートの未解決0）。
短いリストを黙って見せるのではなく、結果にその旨を明記します。

git 依存とスキャン対象のワークスペースメンバーは `not-published` として区別します。
`Cargo.lock` の `source`、yarn の `workspace:` と `git+`、pnpm の tarball URL、
`package-lock.json` の `resolved` — 見分けられる形式すべてで印を付けます。
公開レジストリにライセンス情報が無いので照会しません。これは上限とは別で、
何度スキャンしても解決しません（ライセンスはその出所自体から取る必要があります）。

これは速度の話ではありません。公開パッケージと同じ名前のワークスペースメンバー
（`utils` `core` のような一般的な名前）は、印を付けなければ**無関係な公開パッケージの
ライセンスで `allowed` と報告されます**。ワークスペースのバージョン
（`0.0.0-use.local`）はどの公開版とも一致しないので、照会が最新版に落ちるためです。
出所に印を付けることが、社内パッケージが他人のライセンスを継承するのを防いでいます。

私設レジストリは意図的に例外にしています。`resolved` のホストが npmjs でなくても、
それは Artifactory や Nexus の透過プロキシが公開パッケージをそのまま配っている
可能性が同程度にあり、ロックファイルからは区別できません。従来どおり照会し、
失敗すれば `unresolved` として報告します。

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

## 計測について

ホスト版が保存しないもの: マニフェスト本文、IPアドレス。記録するのは
利用の形（どのツールを、どのエコシステムと配布モデルで呼び、どの判定が出たか）と、
継続利用を数えるための不透明なセッション ID だけ。この行にパッケージ名は入らない。
詳細は [`src/mcp/telemetry.ts`](src/mcp/telemetry.ts)。

パッケージ名を保存している場所が1つだけある。正確に書く。**解決に成功した**
ルックアップを `(ecosystem, package, version) → SPDX id` としてキャッシュしている。
次の呼び出しがレジストリを叩かずに済むため。書き方から次の3つが導かれ、
それぞれテストで固定してある:

- **誰が訊いたかの列が無い。** セッションもリクエストも住所も持たないので、
  キャッシュの行を利用者に結び付ける手段が存在しない
  （[`migrations/0001_init.sql`](migrations/0001_init.sql)）。
- **解決できなかった名前は書かない**（[`src/resolver/index.ts`](src/resolver/index.ts)
  がキャッシュ書き込みの手前で返す）。公開レジストリに無い社内パッケージは、
  まさにこの経路を通る。
- このキャッシュは**非公開ではない**。[`/sitemap.xml`](https://license-guard.rcc-aoki.workers.dev/sitemap.xml)
  の出所がこれである。入っているものは既に npm・PyPI・Go・crates.io で
  その名前で公開されている。

セッション ID は仕様の `Mcp-Session-Id` として発行する。**要求せず、期限切れさせない**ので、
無視するクライアントは今まで通り動く。

**ドメイン移行で増えたものを明記しておく。** 現在のゾーンは Cloudflare Web Analytics が
有効なため、**HTML ページ**にはビーコンが注入される。cookie を使わない集計だが、
移行前には無かった第三者スクリプトではある。注入されるのは HTML だけで、
`/mcp`・`/api/*`・`/llms.txt`・`/sitemap.xml` には入らない。エージェントと API
利用者は読み込まない。

これでも渡しすぎだと感じるなら、ローカル版を使う。公開レジストリへ名前と
バージョンを問い合わせるだけで、それ以外は何も出ない。

## 免責

本ツールが提示するのは、公開されたライセンス条文と依存マニフェストに基づく**情報**であり、法的助言ではない。利用によって弁護士・依頼者関係は成立しない。判定はマニフェストに宣言されたライセンス情報に基づくものであり、全ての義務や違反を網羅するものではない。

## ライセンス

Apache-2.0
