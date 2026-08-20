import {
  ERROR_CODES,
  SUPPORTED_PROTOCOL_VERSIONS,
  errorResponse,
  initializeResult,
  isNotification,
  isValidMessage,
  successResponse,
  type JsonRpcRequest,
} from './protocol';
import { TOOL_DEFINITIONS, callTool, type ToolContext } from './tools';
import { isSyntheticRequest, sanitizeSessionId, type McpEvent, type Recorder } from './telemetry';
import { SITE_ORIGIN } from '../ui/layout';

export interface HandlerContext extends ToolContext {
  /** 省略可。計測が無くてもサーバーは動作する */
  record?: Recorder;
  /**
   * 省略可。上流レジストリへ問い合わせるツールにのみ適用される。
   * 制限に掛かった場合は 429 応答を返す。
   */
  rateLimit?: (weight: 'heavy' | 'light') => Promise<Response | null>;
}

/**
 * ツールごとの重み。上流レジストリに触れないものは制限しない。
 *
 * ping・tools/list・initialize・explain_license は純粋な計算だけで
 * 応答できる。これらを制限すると、実費のかからない操作で正当な利用者を
 * 締め出すことになる。
 */
const TOOL_WEIGHT: Record<string, 'heavy' | 'light'> = {
  // 最大 200 依存を解決しうる
  check_manifest_licenses: 'heavy',
  // 1 パッケージのみ
  check_dependency_license: 'light',
};

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * DNS リバインディング対策として仕様が要求する Origin 検証。
 *
 * 非ブラウザのクライアント（Claude Code 等）は Origin を送らないので、
 * 「無い」は許可する。ブラウザから来た場合のみ出所を確認する。
 */
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/license-guard\.[a-z0-9-]+\.workers\.dev$/,
  /^https:\/\/(www\.)?claude\.ai$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  if (origin === SITE_ORIGIN) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

export function isSupportedProtocolHeader(value: string | null | undefined): boolean {
  if (!value) return true; // 仕様上、未指定は 2025-03-26 とみなす
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

export const SESSION_HEADER = 'Mcp-Session-Id';

/** バッチも単体も受け取るので、initialize が含まれるかを一様に見る */
export function containsInitialize(payload: unknown): boolean {
  const has = (m: unknown) =>
    typeof m === 'object' && m !== null && (m as { method?: unknown }).method === 'initialize';
  return Array.isArray(payload) ? payload.some(has) : has(payload);
}

/**
 * このリクエストに紐づけるセッション ID を決める。
 *
 * クライアントが送ってきたものを最優先する（仕様上、発行後は送るのが MUST）。
 * 無くて initialize なら新規発行する。それ以外は null のまま。
 *
 * **セッションを必須にはしない。** 仕様は必須にする場合に 400 を返すことを
 * 認めているが、そうすると既存の非準拠クライアントが即座に壊れる。計測の
 * ために可用性を落とすのは順序が逆。
 */
export function resolveSession(
  request: Request,
  payload: unknown,
): { sessionId: string | null; issued: string | null } {
  const incoming = sanitizeSessionId(request.headers.get('mcp-session-id'));
  if (incoming) return { sessionId: incoming, issued: null };

  if (containsInitialize(payload)) {
    // 仕様: 暗号学的に安全で、0x21-0x7E の可視 ASCII のみ。UUID は条件を満たす
    const issued = crypto.randomUUID();
    return { sessionId: issued, issued };
  }

  return { sessionId: null, issued: null };
}

async function dispatch(
  msg: JsonRpcRequest,
  ctx: HandlerContext,
): Promise<Record<string, unknown> | null> {
  // 通知には応答しない（呼び出し側が 202 を返す）
  if (isNotification(msg)) return null;

  const id = msg.id as string | number;

  switch (msg.method) {
    case 'initialize': {
      const info = msg.params?.['clientInfo'] as
        | { name?: unknown; version?: unknown }
        | undefined;
      ctx.record?.({
        event: 'initialize',
        clientName: typeof info?.name === 'string' ? info.name : undefined,
        clientVersion: typeof info?.version === 'string' ? info.version : undefined,
      });
      return successResponse(id, initializeResult(msg.params?.['protocolVersion']));
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

      const weight = TOOL_WEIGHT[name];
      if (weight && ctx.rateLimit) {
        const limited = await ctx.rateLimit(weight);
        if (limited) {
          return successResponse(id, {
            content: [
              {
                type: 'text',
                text: 'Rate limit exceeded. This is a free, unauthenticated service; please slow down and retry in a minute.',
              },
            ],
            isError: true,
          });
        }
      }

      try {
        const toolArgs = (args ?? {}) as Record<string, unknown>;
        const result = await callTool(name, toolArgs, ctx);

        // パッケージ名やマニフェスト本文は記録しない（telemetry.ts の方針）
        const structured = result.structuredContent as
          | { verdict?: unknown; summary?: { blocked?: unknown } }
          | undefined;
        ctx.record?.({
          event: 'tool_call',
          tool: name,
          ecosystem: typeof toolArgs['ecosystem'] === 'string' ? toolArgs['ecosystem'] : undefined,
          distributionModel:
            typeof toolArgs['distribution_model'] === 'string'
              ? toolArgs['distribution_model']
              : undefined,
          verdict:
            typeof structured?.verdict === 'string'
              ? structured.verdict
              : result.isError
                ? 'error'
                : undefined,
        });

        return successResponse(id, result);
      } catch (e) {
        // ツール実行時の失敗はプロトコルエラーではなく isError で返す
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

/**
 * Streamable HTTP エンドポイント。
 *
 * サーバー側に会話状態は持たない。initialize でセッション ID を発行するのは
 * **計測の帰属のため**であって、状態を持つためではない。したがって:
 *
 * - セッション ID を要求しない（無くても通す）
 * - セッションを終了させないので 404 を返すことがない
 * - どのリクエストも単体で完結する
 *
 * SSE ストリームは提供しないため GET は 405 を返す。
 */
export async function handleMcpRequest(
  request: Request,
  ctx: HandlerContext,
): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return new Response('Forbidden origin', { status: 403 });
  }

  if (!isSupportedProtocolHeader(request.headers.get('mcp-protocol-version'))) {
    return new Response('Unsupported MCP-Protocol-Version', { status: 400 });
  }

  // 仕様: SSE ストリームを提供しないサーバーは GET に 405 を返してよい
  if (request.method === 'GET') {
    return new Response('This endpoint does not provide an SSE stream. Use POST.', {
      status: 405,
      headers: { allow: 'POST' },
    });
  }

  // 仕様: セッション終了を許さないサーバーは DELETE に 405 を返してよい。
  // 発行するセッション ID は計測の目印でありサーバー側の状態ではないので、
  // 終了させる対象が無い。
  if (request.method === 'DELETE') {
    return new Response('Sessions here are telemetry labels, not server state; nothing to terminate.', {
      status: 405,
      headers: { allow: 'POST' },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      errorResponse(null, ERROR_CODES.PARSE_ERROR, 'Invalid JSON'),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // このリクエストの帰属情報を決め、記録側に自動で載せる。
  // dispatch 側は帰属を意識しない（記録漏れを構造的に防ぐ）。
  const { sessionId, issued } = resolveSession(request, payload);
  const synthetic = isSyntheticRequest(request.headers);

  const reqCtx: HandlerContext = ctx.record
    ? {
        ...ctx,
        record: (e: McpEvent) =>
          ctx.record!({
            ...e,
            ...(sessionId ? { sessionId } : {}),
            ...(synthetic ? { synthetic: true } : {}),
          }),
      }
    : ctx;

  // 仕様: 発行したセッション ID は InitializeResult の応答ヘッダで返す
  const headers = issued ? { ...JSON_HEADERS, [SESSION_HEADER]: issued } : JSON_HEADERS;

  // バッチ（配列）にも応答する
  if (Array.isArray(payload)) {
    const valid = payload.filter(isValidMessage);
    if (valid.length !== payload.length) {
      return Response.json(
        errorResponse(null, ERROR_CODES.INVALID_REQUEST, 'Batch contains an invalid message'),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const responses = (await Promise.all(valid.map((m) => dispatch(m, reqCtx)))).filter(
      (r): r is Record<string, unknown> => r !== null,
    );

    // すべて通知だった場合は本文なしの 202
    if (responses.length === 0) {
      return new Response(null, {
        status: 202,
        ...(issued ? { headers: { [SESSION_HEADER]: issued } } : {}),
      });
    }
    return Response.json(responses, { headers });
  }

  if (!isValidMessage(payload)) {
    return Response.json(
      errorResponse(null, ERROR_CODES.INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 message'),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const response = await dispatch(payload, reqCtx);

  // 仕様: 通知・レスポンスを受け取った場合は本文なしの 202 Accepted
  if (response === null) {
    return new Response(null, {
      status: 202,
      ...(issued ? { headers: { [SESSION_HEADER]: issued } } : {}),
    });
  }

  return Response.json(response, { headers });
}
