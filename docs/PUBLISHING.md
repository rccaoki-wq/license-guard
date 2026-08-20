# レジストリ登録手順

MCP サーバーの発見経路はレジストリです。誰も知らないサーバーはインストールされないため、
ここが公開後の律速になります。

## 1. 公式 MCP Registry（最優先）

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

名前空間は `io.github.tyou20256-stack/license-guard`。GitHub アカウントの所有権が
そのまま名前空間の証明になるため、DNS レコードの設定は不要です。

登録後の確認:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=license-guard"
```

## 2. サードパーティのカタログ

いずれもフォームまたは GitHub 連携での申請です。

| カタログ | 規模 | 備考 |
|---|---|---|
| [mcp.so](https://mcp.so) | 2万件超 | 掲載数が最大 |
| [smithery.ai](https://smithery.ai) | 7千件超 | エコシステムの Docker Hub 的位置づけ |
| [glama.ai/mcp](https://glama.ai/mcp) | — | 閲覧体験が良い |
| [GitHub MCP Registry](https://github.com/mcp) | — | 単一の情報源を標榜 |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | — | PR を送る |

多くは公式レジストリの API を取り込むため、まず公式に載せるのが効率的です。

## 3. 掲載は信頼ではない

2026 年の実質的な障壁は発見ではなく信頼です。レジストリ掲載はコードの安全性も
ツール説明の正直さも保証しません。利用者が見る信号は GitHub のスター数と組織の
検証状態なので、以下は掲載作業より優先度が高い場合があります。

- リポジトリを公開し、監査可能にしておくこと（済）
- ライセンスを明示すること（済 / Apache-2.0）
- **マニフェストを預かるサーバーとして、何を保存しないかを明示すること**
  （`src/mcp/telemetry.ts` にパッケージ名とマニフェスト本文を保存しない旨を記載）
