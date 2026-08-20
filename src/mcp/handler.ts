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
import { SITE_ORIGIN } from '../ui/layout';

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

async function dispatch(
  msg: JsonRpcRequest,
  ctx: ToolContext,
): Promise<Record<string, unknown> | null> {
  // 通知には応答しない（呼び出し側が 202 を返す）
  if (isNotification(msg)) return null;

  const id = msg.id as string | number;

  switch (msg.method) {
    case 'initialize':
      return successResponse(id, initializeResult(msg.params?.['protocolVersion']));

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
        const result = await callTool(
          name,
          (args ?? {}) as Record<string, unknown>,
          ctx,
        );
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
 * ステートレスな Streamable HTTP エンドポイント。
 *
 * セッション ID を発行しないため、クライアントは以降のリクエストで
 * Mcp-Session-Id を送らない。SSE ストリームも提供しないため GET は 405 を返す。
 */
export async function handleMcpRequest(
  request: Request,
  ctx: ToolContext,
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

  // 仕様: セッション終了を許さないサーバーは DELETE に 405 を返してよい
  if (request.method === 'DELETE') {
    return new Response('This server is stateless and has no sessions to terminate.', {
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

  // バッチ（配列）にも応答する
  if (Array.isArray(payload)) {
    const valid = payload.filter(isValidMessage);
    if (valid.length !== payload.length) {
      return Response.json(
        errorResponse(null, ERROR_CODES.INVALID_REQUEST, 'Batch contains an invalid message'),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const responses = (await Promise.all(valid.map((m) => dispatch(m, ctx)))).filter(
      (r): r is Record<string, unknown> => r !== null,
    );

    // すべて通知だった場合は本文なしの 202
    if (responses.length === 0) return new Response(null, { status: 202 });
    return Response.json(responses, { headers: JSON_HEADERS });
  }

  if (!isValidMessage(payload)) {
    return Response.json(
      errorResponse(null, ERROR_CODES.INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 message'),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const response = await dispatch(payload, ctx);

  // 仕様: 通知・レスポンスを受け取った場合は本文なしの 202 Accepted
  if (response === null) return new Response(null, { status: 202 });

  return Response.json(response, { headers: JSON_HEADERS });
}
