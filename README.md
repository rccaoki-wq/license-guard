# LicenseGuard

依存 OSS のライセンスが、あなたの**配布モデル**に対して法的義務を発生させるかを判定するツール。

本番: https://license-guard.rcc-aoki.workers.dev

## 何が違うのか

既存のライセンスコンプライアンス製品は「判定が深いが商談必須（FOSSA / Black Duck）」か「セルフサーブだが判定が浅い（Snyk）」に二分され、その交差点に製品が存在しない。

差別化の中核は**判定層**にある。同じライセンスでも文脈で結論が真逆になる。

| 使い方 | AGPL-3.0 の帰結 |
|---|---|
| SaaS として外部提供 | 開示義務あり |
| 社内システムでのみ利用 | 義務なし |
| 顧客に納品・配布 | 開示義務あり |
| **devDependency**（成果物に含まれない） | **義務なし** |

最後の行が決定的。既存ツールの多くは dev と runtime を区別せず警告を出し、オオカミ少年化して無視される。

## 現在のフェーズ

**Phase 0（支払意思の検証）** — 無料 Web ツールを公開し、有料レポート CTA のクリック率を実測する。GitHub App（Phase 1）は検証結果を見てから着手する。

対応: npm / PyPI / Go modules の**直接依存のみ**。推移的依存は Phase 1。

## 開発

```bash
npm install
npm test          # 115 tests
npm run typecheck
npm run smoke     # 実レジストリへの疎通確認
npm run dev       # http://localhost:8787
```

デプロイ:

```bash
npm run db:migrate
npm run deploy
```

## ドキュメント

- 設計仕様書: [docs/specs/2026-08-19-license-guard-design.md](docs/specs/2026-08-19-license-guard-design.md)
- Phase 0 実装計画: [docs/superpowers/plans/2026-08-19-phase0-free-web-tool.md](docs/superpowers/plans/2026-08-19-phase0-free-web-tool.md)

## 依存 OSS

本製品自身が扱う題材の性質上、依存はすべて MIT / Apache-2.0 系に限定している。自社 SaaS に開示義務は発生しない。

| 役割 | OSS | ライセンス |
|---|---|---|
| SPDX 式のパース | `spdx-expression-parse` | MIT |
| Web フレームワーク | `hono` | MIT |
| Go のライセンスデータ | ClearlyDefined API | Apache-2.0 |

## 免責

本ツールが提示するのは、公開されたライセンス条文と依存マニフェストに基づく**情報**であり、法的助言ではない。利用によって弁護士・依頼者関係は成立しない。判定はマニフェストに宣言されたライセンス情報に基づくものであり、全ての義務や違反を網羅するものではない。
