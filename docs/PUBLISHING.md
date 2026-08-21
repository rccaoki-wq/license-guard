# レジストリ登録手順

MCP サーバーの発見経路はレジストリです。誰も知らないサーバーはインストールされないため、
ここが公開後の律速になります。

## 状態

**公式 MCP Registry には登録済み**（2026-08-20、`io.github.rccaoki-wq/license-guard` v1.0.0）。
下記は再公開時の手順と、未着手のサードパーティカタログの一覧。

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=license-guard"
```

### 実施時にはまった点

- **デバイス認証のブラウザ側アカウントと名前空間は一致していなければならない。**
  `gh` CLI の認証先とは無関係で、承認時にブラウザでログインしているアカウントが使われる。
  食い違うと publish が 403 になり、権限のある名前空間が応答に示される。
- **Registry JWT の有効期限が短い。** login から publish まで間を空けると 401 になる。
  リポジトリ移管などの作業を挟む場合は、作業を終えてから login すること。

## 1. 公式 MCP Registry（登録済み）

`server.json` は作成済みで、公式スキーマ（2025-12-11）の検証を通過しています。
残る作業は認証と公開の 2 コマンドだけですが、**GitHub OAuth のデバイスフロー認証が
必要なため、ブラウザ操作が要ります**。

```bash
# CLI を入れる
curl -fsSL https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_amd64.tar.gz | tar xz mcp-publisher

# 認証（ブラウザが開き、コードの入力を求められる）
./mcp-publisher login github

# 公開
./mcp-publisher publish
```

名前空間は `io.github.rccaoki-wq/license-guard`。GitHub アカウントの所有権が
そのまま名前空間の証明になるため、DNS レコードの設定は不要です。

登録後の確認:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=license-guard"
```

## 2. サードパーティのカタログ

いずれもフォームまたは GitHub 連携での申請です。

| カタログ | 規模 | 状態 |
|---|---|---|
| [公式 MCP Registry](https://registry.modelcontextprotocol.io) | — | **登録済** `io.github.rccaoki-wq/license-guard` v1.0.0 active |
| [glama.ai/mcp](https://glama.ai/mcp) | — | **登録済**（自動取り込み）。quality **A** / license **A** / maintenance B |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | 9.2万スター | **PR提出済** [#12523](https://github.com/punkpeye/awesome-mcp-servers/pull/12523)（Legal） |
| [mcp.so](https://mcp.so) | 2万件超 | **申請済** [chatmcp/mcpso#3658](https://github.com/chatmcp/mcpso/issues/3658)。**GitHub issue で申請する**（サイトのフォームではない）。タイトルは `[Submit] ...` |
| [docker/mcp-registry](https://github.com/docker/mcp-registry) | Docker Desktop 同梱 | **PR提出済** [#4742](https://github.com/docker/mcp-registry/pull/4742) |
| [PulseMCP](https://www.pulsemcp.com) | — | 申請不要。公式レジストリから自動取り込み（申請受付は停止中） |
| [GitHub MCP Registry](https://github.com/mcp) | — | 申請不要。公式レジストリから自動取り込み |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | 9万スター | **受付終了**。コミュニティ一覧は廃止され公式レジストリに一本化された |
| [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) | 5.8千スター | **アーカイブ済**。PR も issue も受け付けない |
| [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) | 4.3千スター | PR不可。[mcpservers.org/submit](https://mcpservers.org/submit) のフォーム（**ブラウザとメールアドレスが要る**） |
| [smithery.ai](https://smithery.ai) | 7千件超 | **登録済** `rcc-aoki/license-guard`。スキャンは3ツールを検出。ただし掲載本文は空のまま（後述） |

### Smithery の verified バッジは workers.dev では取れない

検証条件は6つあり、うち1つが「**homepage のホスト名そのものに TXT レコード**」。

```
smithery-verification=<token>  を license-guard.rcc-aoki.workers.dev の TXT に
```

**これは設定できない。** `workers.dev` は Cloudflare 自身が持つゾーンで、
割り当てられたサブドメインに DNS レコードを足す手段が無い。

```
rcc-aoki.workers.dev SOA = leland.ns.cloudflare.com
workers.dev NS          = clyde.ns.cloudflare.com / sofia.ns.cloudflare.com
```

**独自ドメインに移すまで verified は取れない。** 移すなら、各カタログの掲載
（公式レジストリ / Glama / Smithery / mcp.so / docker-registry / awesome）に
URL が焼き付く前、つまり審査中の今が最も安い。

他の条件の状況:

| 条件 | 状態 |
|---|---|
| リリースが成功している | 済 |
| quality score > 80 | **79**。description を入れて 55 → 79 まで上がった |
| homepage が設定されている | 済 |
| homepage ホストの TXT | **不可**（上記） |
| Smithery へのリンク | 済。README とサイト全ページのフッタに設置 |
| 有料の developer plan | 未（費用が要る） |

- **Smithery の掲載メタデータは CLI から入れられない。** Settings > General の
  Web フォームで入れる。CLI に渡せるのは `--config-schema` だけ
- **`smithery.ai/badge/<ns>/<name>` は 500 を返す**（2026-08-21 時点）。
  壊れた画像になるので貼らない。逆リンク条件はサーバーURLへの普通のリンクで満たせる
- スキャンログは `%TEMP%\smithery-deploy-<id>.log` に出る。ここで
  `Server info retrieved. name: ..., version: ...` が見えるので、
  **本番の再デプロイ忘れがここで発覚する**（実際に 1.0.0 のままだと分かった）

### 残っているもの

- **mcpservers.org（wong2 系）**: フォームにブラウザとメールアドレスが要る
- **Smithery の掲載本文**: CLI にメタデータを渡す口が無い（`--config-schema` のみ）。
  スキャンログ上は `Capabilities found: 3 tools` まで通っているのに、掲載ページの
  description / repository / tools が空。Web UI 側の設定項目と思われる

## パッケージ公開（GHCR）

`.github/workflows/publish.yml` がリリース時に自動で行う。

- **`mcp-publisher login github-oidc` を使う**。ブラウザのデバイスフローも保存トークンも要らない。
  以前は「JWT の期限が短いので作業を挟むな」という運用でしのいでいたが、OIDC ならその問題自体が消える
- **イメージは push 前に起動して確かめる**。`initialize` と `tools/list` を実際に流し、
  ツールが3件あることまで見てから push する
- **公式レジストリは OCI パッケージに所有権の証明を要求する。**
  Dockerfile に `LABEL io.modelcontextprotocol.server.name="io.github.<owner>/<name>"` が要る。
  無いと publish が 400 で拒否される（他人の公開イメージを自分のサーバー記録に結び付けられないため）
- **イメージは public でなければならない。** private だと検証が 401/403 で落ちる
- **`packages[]` の OCI エントリに `registryBaseUrl` と `version` を書いてはいけない。**
  どちらも 400 になる。版は `identifier` のタグで示す（`ghcr.io/owner/name:1.1.0`）。
  2回連続で弾かれてから気づいた
- 同じ版を publish し直すと 400 になるので、ワークフロー側で公開済みなら飛ばしている

### 必要だったスコープ

`gh auth refresh -h github.com -s workflow,write:packages`。
`workflow` が無いと `.github/workflows/` を push できず、`write:packages` が無いと GHCR に出せない。

### Glama は申請不要（自動取り込み）

公式MCPレジストリと GitHub の両方から自動で拾われる。手動申請はしていない。

- servers: `https://glama.ai/mcp/servers/rccaoki-wq/license-guard`（license A / maintenance B）
- connectors: `https://glama.ai/mcp/connectors/io.github.rccaoki-wq/license-guard`（Status: Healthy）

**登録直後はスコアが未計算で、バッジURLが SVG を返しつつ HTTP 404 になる。**
404 のバッジを貼ると壊れて見えるので、200 を確認してから貼ること。

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://glama.ai/mcp/servers/rccaoki-wq/license-guard/badges/score.svg
```

ただし**200 は採点済みを意味しない**。ビルドを作る前の段階でも 200 を返し、
中身は quality が未採点（グレーの `-`）のバッジになる。貼る前にサーバーページの
scorecard で quality に等級が入っていることを目視すること。

#### quality score には Glama 上の release が要る

license / maintenance は GitHub のメタデータだけで付くが、**quality は
Dockerfile からイメージを作って実際に起動し、ツール定義を読んで採点する**。
そのため `Claim` → `build spec` 入力 → `Build` → `Make Release` まで
進めないと `quality - not tested` のままになる。これがローカル stdio 版
（`src/local/stdio.ts`）を用意した直接の動機。

#### build spec の書式と落とし穴

- **Build steps は JSON 配列**。`["npm ci", "npm run build:stdio"]`。
  改行区切りのプレーンテキストで書くと `Invalid JSON` になる
- **CMD には Glama が `mcp-proxy` を自動で前置する**
  （`["mcp-proxy","--","node","dist/stdio.mjs"]`）。stdio を SSE に変換するため。触らない
- **Glama が持つリポジトリの HEAD は古いことがある。** 生成される Dockerfile の
  `git checkout <sha>` が最新コミットでないと、新しく追加した npm script が
  `Missing script` で落ちる。`Pinned commit SHA` 欄も反映されないことがあった
- **確実な回避策は build steps の先頭で自分でチェックアウトし直すこと。**
  `git clone` はフルクローンなので目的の SHA はコンテナ内に既にある

```json
["git checkout <full-sha>", "npm ci", "npm run build:stdio"]
```

  同期が済んだら 1 行目は消してよい。デフォルトブランチは `master`（`main` ではない）

### awesome-mcp-servers に出すときの注意

- **自動エージェントは PR タイトル末尾に `🤖🤖🤖` を付ける**規約がある（CONTRIBUTING.md）。付けると早期マージの対象になる。隠さず使うこと
- カテゴリ内はアルファベット順（owner 名基準、大文字小文字を区別しない）
- 1行1サーバー。差分は最小にする
- LicenseGuard は Legal に置いた。`ark-forge/mcp-eu-ai-act`（コードベースの規制違反スキャナ）と同じ形だから
- 記載する主張（リンク、エンドポイント、対応形式）は**提出前に実際に叩いて確認する**
- **PR を出すと bot が Glama への登録とスコアバッジを要求してくる**。「動くサーバーだけを載せる」ための第三者検証。Glama は自動取り込みなので、採点が済むのを待ってバッジを貼れば済む
- **バッジの位置は bot の文面（説明の後）ではなく、既存1,995件の慣習（リポジトリリンクの直後・絵文字の前）に合わせた**。文面より実データを優先する

多くは公式レジストリの API を取り込むため、まず公式に載せるのが効率的です。

## 掲載直後に来るのはクローラーであって利用者ではない

公式レジストリに載せた当日、**30 種類以上の第三者クローラー・採点ボットが自力で
発見して実際にツールを呼びに来た**。半日でこれだけ動くので、発見経路としての
レジストリは確かに機能する。

ただし**これを需要と読み違えないこと**。初日の mcp_events 981 件の内訳は、
名前付きクライアント 33 種がすべて巡回・採点・カタログ収集で、残りは自分の E2E。
実利用者はゼロだった。

実際に来た名前（判別の参考）:

```
glimind-probe        proofbench-probe     verifymcp-probe    AgentIndexBot
MCP-Marketplace-Scanner  mcpgrade         mcpqueen-grader    zerm-tool-census
rootz-mcp-registry-prober  tiza-search-prober  agentage-mcp-catalog
spanly-health-monitor  x402-observatory   glama-mcp-inspector  mcphub-probe
```

`npm run signals` がこれらを除外して集計する。判断は必ずそちらを見ること。

## 3. 掲載は信頼ではない

2026 年の実質的な障壁は発見ではなく信頼です。レジストリ掲載はコードの安全性も
ツール説明の正直さも保証しません。利用者が見る信号は GitHub のスター数と組織の
検証状態なので、以下は掲載作業より優先度が高い場合があります。

- リポジトリを公開し、監査可能にしておくこと（済）
- ライセンスを明示すること（済 / Apache-2.0）
- **マニフェストを預かるサーバーとして、何を保存しないかを明示すること**
  （`src/mcp/telemetry.ts` にパッケージ名とマニフェスト本文を保存しない旨を記載）
