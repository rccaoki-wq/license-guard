import {
  ERROR_CODES,
  errorResponse,
  initializeResult,
  isNotification,
  successResponse,
  type JsonRpcRequest,
} from '../mcp/protocol';
import { TOOL_DEFINITIONS, callTool, type ToolContext } from '../mcp/tools';
import { cacheKey } from '../resolver/cache';
import type { CacheLike } from '../resolver';
import type { Dependency } from '../types';

/**
 * ローカル実行時のライセンスキャッシュ。
 *
 * ホスト版は D1 の共有キャッシュを使うが、ローカルではプロセス内に持つ。
 * 依存関係の一覧が手元から出ないことが、ローカル版を使う理由そのものなので、
 * 外部の保存先には一切書かない。
 *
 * 上限を設けているのは、巨大なロックファイルを何度も走査したときに
 * 際限なくメモリを食わないようにするため。古いものから捨てる。
 */
export class MemoryCache implements CacheLike {
  private readonly store = new Map<string, { spdx: string | null; source: string }>();

  constructor(private readonly limit = 20_000) {}

  async get(dep: Dependency) {
    if (dep.version === null) return null;
    return this.store.get(cacheKey(dep.ecosystem, dep.name, dep.version)) ?? null;
  }

  async put(dep: Dependency, spdx: string | null, source: string) {
    if (dep.version === null) return;

    const key = cacheKey(dep.ecosystem, dep.name, dep.version);
    // 入れ直して挿入順を最新にする（Map は挿入順を保つ）
    this.store.delete(key);
    this.store.set(key, { spdx, source });

    while (this.store.size > this.limit) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  async getMany(deps: Dependency[]) {
    const found = new Map<string, { spdx: string | null; source: string }>();
    for (const d of deps) {
      if (d.version === null) continue;
      const key = cacheKey(d.ecosystem, d.name, d.version);
      const hit = this.store.get(key);
      if (hit) found.set(key, hit);
    }
    return found;
  }
}

/**
 * stdio は改行区切り。メッセージ本体に改行を含めてはならない。
 */
export function encodeMessage(msg: unknown): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * 受信バッファから完結した行だけを取り出す。
 * 途中で切れた分は次の chunk と繋ぐため rest として返す。
 */
export function splitMessages(buffer: string): { messages: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  const messages = parts.map((p) => p.replace(/\r$/, '')).filter((p) => p.trim() !== '');
  return { messages, rest };
}

const LOCAL_INSTRUCTIONS =
  ' This instance runs locally: the manifest you pass it never leaves your machine. Only package names and versions are sent to public registries to look up licenses.';

/**
 * ローカル版のメッセージ処理。
 *
 * ホスト版（src/mcp/handler.ts）と同じ判定・同じツールを使う。
 * 違いは経路だけで、答えが食い違うことがあってはならない。
 * 計測とレート制限は持たない（手元で動くものに要らない）。
 */
export async function handleLocalMessage(
  msg: JsonRpcRequest,
  ctx: ToolContext,
): Promise<any> {
  if (isNotification(msg)) return null;

  const id = msg.id as string | number;

  switch (msg.method) {
    case 'initialize': {
      const result = initializeResult(msg.params?.['protocolVersion']);
      return successResponse(id, {
        ...result,
        instructions: result.instructions + LOCAL_INSTRUCTIONS,
      });
    }

    case 'ping':
      return successResponse(id, {});

    case 'tools/list':
      return successResponse(id, { tools: TOOL_DEFINITIONS });

    case 'tools/call': {
      const name = msg.params?.['name'];
      const args = msg.params?.['arguments'];

      if (typeof name !== 'string') {
        return errorResponse(id, ERROR_CODES.INVALID_PARAMS, 'params.name must be a string');
      }
      if (!TOOL_DEFINITIONS.some((t) => t.name === name)) {
        return errorResponse(id, ERROR_CODES.INVALID_PARAMS, `Unknown tool: ${name}`);
      }

      try {
        return successResponse(id, await callTool(name, (args ?? {}) as Record<string, unknown>, ctx));
      } catch (e) {
        return successResponse(id, {
          content: [
            { type: 'text', text: e instanceof Error ? e.message : 'Tool execution failed.' },
          ],
          isError: true,
        });
      }
    }

    default:
      return errorResponse(id, ERROR_CODES.METHOD_NOT_FOUND, `Unknown method: ${msg.method}`);
  }
}
