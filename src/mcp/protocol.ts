/**
 * ステートレスな Streamable HTTP MCP サーバーのプロトコル層。
 *
 * ツールのみを提供しセッション状態を持たないため、Durable Objects は不要。
 * 仕様上必要な範囲だけを実装する。
 */

export const SERVER_INFO = {
  name: 'licenseguard',
  title: 'LicenseGuard',
  version: '1.0.0',
} as const;

/** 出荷済みの MCP プロトコルバージョン。ここに無いものは 400 を返す */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
] as const;

export const LATEST_PROTOCOL_VERSION = '2025-06-18';

/** MCP-Protocol-Version ヘッダが無い場合に想定するバージョン（仕様の既定） */
export const ASSUMED_PROTOCOL_VERSION = '2025-03-26';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function isNotification(msg: JsonRpcRequest): boolean {
  return msg.id === undefined || msg.id === null;
}

export function isValidMessage(v: unknown): v is JsonRpcRequest {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return m['jsonrpc'] === '2.0' && typeof m['method'] === 'string';
}

export function successResponse(id: string | number, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

export function errorResponse(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

/**
 * バージョン交渉。
 *
 * 本サーバーはツールのみを提供し、どの出荷済みバージョンとも互換であるため、
 * クライアントが要求したバージョンをそのまま返す。未知のものだけ最新に落とす。
 */
export function negotiateVersion(requested: unknown): string {
  if (
    typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

export function initializeResult(requestedVersion: unknown) {
  return {
    protocolVersion: negotiateVersion(requestedVersion),
    // ツール一覧は静的なので listChanged 通知は出さない
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions:
      'Use LicenseGuard to determine whether an open source dependency creates a legal obligation for the way this project is shipped. The same license produces different results for hosted SaaS, distributed binaries, on-premises delivery, internal-only use, and published libraries, so always pass the distribution model. Build-time-only dependencies do not carry distribution obligations; pass scope "dev" for those. Results are informational and are not legal advice.',
  };
}
