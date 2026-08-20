#!/usr/bin/env node
/**
 * LicenseGuard をローカルで動かす MCP サーバー（stdio 版）。
 *
 * ホスト版と同じ判定エンジンを使い、同じツールを提供する。違いは経路だけ。
 *
 * ローカル版を用意する理由は 2 つある。
 *
 * 1. **依存関係の一覧が手元から出ない。** コンプライアンスを扱う道具に
 *    ロックファイルを送りたくない組織は実在する。ここでは公開レジストリへ
 *    パッケージ名とバージョンを問い合わせるだけで、マニフェストは送らない。
 * 2. npx で入る配布経路になる。
 *
 * stdio の約束: **stdout には MCP メッセージ以外を書いてはならない。**
 * ログは stderr に出す。
 */
import { MemoryCache, encodeMessage, handleLocalMessage, splitMessages } from './stdio-core';
import { isValidMessage, errorResponse, ERROR_CODES, SERVER_INFO } from '../mcp/protocol';

const cache = new MemoryCache();
const ctx = { cache };

function write(msg: unknown): void {
  process.stdout.write(encodeMessage(msg));
}

function log(line: string): void {
  // stdout を汚さない
  process.stderr.write(`[licenseguard] ${line}\n`);
}

let buffer = '';
let pending = Promise.resolve();

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const { messages, rest } = splitMessages(buffer);
  buffer = rest;

  for (const raw of messages) {
    // 受信順に処理する。並行に走らせると応答の順序が入れ替わりうる
    pending = pending.then(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        write(errorResponse(null, ERROR_CODES.PARSE_ERROR, 'Invalid JSON'));
        return;
      }

      if (!isValidMessage(parsed)) {
        write(errorResponse(null, ERROR_CODES.INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 message'));
        return;
      }

      try {
        const response = await handleLocalMessage(parsed, ctx);
        if (response !== null) write(response);
      } catch (e) {
        // ここで落ちるとクライアントが応答を待ち続けるので、必ず何か返す
        const id = (parsed as { id?: string | number }).id ?? null;
        write(
          errorResponse(
            id,
            ERROR_CODES.INTERNAL_ERROR,
            e instanceof Error ? e.message : 'Internal error',
          ),
        );
      }
    });
  }
});

process.stdin.on('end', () => {
  pending.then(() => process.exit(0));
});

process.on('uncaughtException', (e) => {
  log(`uncaught: ${e instanceof Error ? e.message : String(e)}`);
});

log(`${SERVER_INFO.name} ${SERVER_INFO.version} ready on stdio`);
