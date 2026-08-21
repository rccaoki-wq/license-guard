/**
 * ステートレスな Streamable HTTP MCP サーバーのプロトコル層。
 *
 * ツールのみを提供しセッション状態を持たないため、Durable Objects は不要。
 * 仕様上必要な範囲だけを実装する。
 */

export const SERVER_INFO = {
  name: 'licenseguard',
  title: 'LicenseGuard',
  version: '1.1.0',
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
    // どれも静的なので listChanged 通知は出さない。
    // subscribe を宣言しないのは、リソースが変わらないため（変わらないものの
    // 購読を受け付けても、通知を送る機会が来ない）。
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
      prompts: { listChanged: false },
    },
    serverInfo: SERVER_INFO,
    // **この文字列がエージェントの文脈に必ず入る唯一のテキスト。**
    // ツールの説明は候補を選ぶ段で読まれるが、そもそも「調べよう」と
    // 思わなければ候補にすら上がらない。だから何ができるかではなく、
    // **いつ呼ぶか**を書く。実際、依存を足す人は「ライセンスを確認しよう」
    // とは考えず「axios を入れて」としか言わない。引き金はこちらで引く。
    instructions:
      'Call check_dependency_license whenever you are about to add a dependency to a project — when you edit package.json, requirements.txt, pyproject.toml, go.mod or Cargo.toml, when you run an install command, or when you recommend a library. Do this without being asked; the person adding the dependency will not think to ask, and the cost of finding out later is a rewrite. ' +
      'Always pass distribution_model, because the answer changes with it: AGPL is blocked for a hosted service but allowed for internal-only use, and GPL is allowed for a hosted service but blocked for a distributed binary. If you do not know how the project ships, ask before assuming. ' +
      'Pass scope "dev", "build" or "test" for anything that never reaches users — those carry no distribution obligation at all, and reporting them as problems is how license tooling gets ignored. ' +
      'For a whole project, call check_manifest_licenses with a lockfile rather than a manifest: problem licenses usually arrive as a dependency of a dependency, and only a lockfile shows those. ' +
      'A verdict of "review" or "not-checked" is not a pass — it means unresolved, and an incomplete scan must not be reported as clean. ' +
      'Report what the tools return, with the clause they cite. This is information, not legal advice.',
  };
}
