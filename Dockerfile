# LicenseGuard を stdio の MCP サーバーとして動かすための像。
#
# ホスト版（Cloudflare Workers）とは経路が違うだけで、判定エンジンは同一。
# ここで動かす版は依存関係の一覧を外部に送らず、公開レジストリへ
# パッケージ名とバージョンを問い合わせるだけで済む。

FROM node:22-alpine AS build
WORKDIR /app

# 依存の解決を先に済ませ、ソース変更でここを作り直さない
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# stdio 版を 1 ファイルに束ねる。実行時に tsx を要らなくするため
RUN npx --yes esbuild src/local/stdio.ts \
      --bundle \
      --platform=node \
      --target=node22 \
      --format=esm \
      --outfile=dist/stdio.mjs

FROM node:22-alpine
WORKDIR /app

# 公式 MCP レジストリはこのラベルだけを OCI パッケージの所有権証明として使う。
# 無い・値が違うと publish が拒否される（登録者が自分の管理外の公開イメージを
# 自分のサーバー記録に結び付けられないようにするため）。
LABEL io.modelcontextprotocol.server.name="io.github.rccaoki-wq/license-guard"

LABEL org.opencontainers.image.source="https://github.com/rccaoki-wq/license-guard"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.description="Decides whether an open source dependency's license obligates you, given how you ship."

# 根拠を残す。ライセンスを扱う道具が自分のライセンスを同梱しないのは筋が通らない
COPY --from=build /app/dist/stdio.mjs ./stdio.mjs
COPY LICENSE NOTICE ./

# 権限を落として動かす
USER node

# stdio は stdout を MCP メッセージ専用に使う。ログは stderr へ出す
ENTRYPOINT ["node", "/app/stdio.mjs"]
