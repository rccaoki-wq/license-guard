import { describe, expect, it } from 'vitest';
import { handleMcpRequest, isAllowedOrigin, isSupportedProtocolHeader } from '../../src/mcp/handler';
import { TOOL_DEFINITIONS } from '../../src/mcp/tools';
import { LATEST_PROTOCOL_VERSION, negotiateVersion } from '../../src/mcp/protocol';
import type { CacheLike } from '../../src/resolver';

const cache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

const fetchers = (map: Record<string, string | null>) => {
  const look = async (n: string) => ({ spdx: map[n] ?? null });
  return { npm: look, pypi: look, go: look, cargo: look };
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://license-guard.rcc-aoki.workers.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const ctx = (map: Record<string, string | null> = {}) => ({ cache, fetchers: fetchers(map) });

async function rpc(body: unknown, map: Record<string, string | null> = {}) {
  const res = await handleMcpRequest(post(body), ctx(map));
  return { res, json: res.status === 202 ? null : ((await res.json()) as any) };
}

describe('Origin 検証（DNS リバインディング対策）', () => {
  it('Origin 無しは許可する（非ブラウザのクライアント）', () => {
    expect(isAllowedOrigin(null)).toBe(true);
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it('自サイトと localhost と claude.ai を許可する', () => {
    expect(isAllowedOrigin('https://license-guard.rcc-aoki.workers.dev')).toBe(true);
    expect(isAllowedOrigin('http://localhost:6274')).toBe(true);
    expect(isAllowedOrigin('https://claude.ai')).toBe(true);
  });

  it('見知らぬオリジンを拒否する', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });

  it('拒否されたオリジンには 403 を返す', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example.com' }),
      ctx(),
    );
    expect(res.status).toBe(403);
  });
});

describe('MCP-Protocol-Version ヘッダ', () => {
  it('未指定を許可する', () => {
    expect(isSupportedProtocolHeader(null)).toBe(true);
  });

  it('既知バージョンを許可する', () => {
    expect(isSupportedProtocolHeader('2025-06-18')).toBe(true);
    expect(isSupportedProtocolHeader('2024-11-05')).toBe(true);
  });

  it('未対応バージョンには 400 を返す（仕様の MUST）', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });
});

describe('HTTP メソッド', () => {
  it('GET は 405 を返す（SSE を提供しないため）', async () => {
    const res = await handleMcpRequest(
      new Request('https://x/mcp', { method: 'GET' }),
      ctx(),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('DELETE は 405 を返す（セッションを持たないため）', async () => {
    const res = await handleMcpRequest(
      new Request('https://x/mcp', { method: 'DELETE' }),
      ctx(),
    );
    expect(res.status).toBe(405);
  });
});

describe('initialize', () => {
  it('要求されたバージョンをそのまま返す', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    });
    expect(json.result.protocolVersion).toBe('2025-03-26');
  });

  it('未知バージョンは最新に落とす', () => {
    expect(negotiateVersion('3000-01-01')).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('tools capability と serverInfo を返す', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(json.result.capabilities.tools).toBeDefined();
    expect(json.result.serverInfo.name).toBe('licenseguard');
    expect(json.result.instructions).toContain('distribution model');
  });

  it('セッションIDヘッダを発行しない（ステートレス）', async () => {
    const { res } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });
});

describe('通知', () => {
  it('notifications/initialized には本文なしの 202 を返す', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      ctx(),
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });
});

describe('tools/list', () => {
  it('3つのツールを返す', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(json.result.tools).toHaveLength(3);
    expect(json.result.tools.map((t: any) => t.name)).toEqual([
      'check_dependency_license',
      'check_manifest_licenses',
      'explain_license',
    ]);
  });

  it('全ツールが name / description / inputSchema を持つ', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    for (const t of json.result.tools) {
      expect(typeof t.name).toBe('string');
      expect(t.description.length).toBeGreaterThan(60);
      expect(t.inputSchema.type).toBe('object');
      expect(Array.isArray(t.inputSchema.required)).toBe(true);
    }
  });

  it('description がエージェントに呼ぶタイミングを伝える', () => {
    const t = TOOL_DEFINITIONS.find((x) => x.name === 'check_dependency_license')!;
    expect(t.description).toContain('BEFORE adding a new dependency');
  });
});

describe('tools/call — check_dependency_license', () => {
  it('SaaS の AGPL を blocked として返す', async () => {
    const { json } = await rpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: { ecosystem: 'npm', name: 'agpl-lib', distribution_model: 'saas' },
        },
      },
      { 'agpl-lib': 'AGPL-3.0-only' },
    );
    expect(json.result.structuredContent.verdict).toBe('blocked');
    expect(json.result.content[0].text).toContain('OBLIGATION TRIGGERED');
    expect(json.result.isError).toBeUndefined();
  });

  it('同じ依存でも internal-only なら allowed', async () => {
    const { json } = await rpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: { ecosystem: 'npm', name: 'agpl-lib', distribution_model: 'internal-only' },
        },
      },
      { 'agpl-lib': 'AGPL-3.0-only' },
    );
    expect(json.result.structuredContent.verdict).toBe('allowed');
  });

  it('dev スコープは警告しない', async () => {
    const { json } = await rpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: {
            ecosystem: 'npm',
            name: 'agpl-lib',
            distribution_model: 'saas',
            scope: 'dev',
          },
        },
      },
      { 'agpl-lib': 'AGPL-3.0-only' },
    );
    expect(json.result.structuredContent.verdict).toBe('allowed');
  });

  it('解決できない場合は review にし、断定を避ける', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'check_dependency_license',
        arguments: { ecosystem: 'npm', name: 'mystery', distribution_model: 'saas' },
      },
    });
    expect(json.result.structuredContent.verdict).toBe('review');
    expect(json.result.content[0].text).toContain('lookup itself may have failed');
  });

  it('不正な引数は isError で返す（プロトコルエラーにしない）', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'check_dependency_license',
        arguments: { ecosystem: 'maven', name: 'x', distribution_model: 'saas' },
      },
    });
    expect(json.result.isError).toBe(true);
    expect(json.error).toBeUndefined();
  });

  it('結果に免責を含める', async () => {
    const { json } = await rpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: { ecosystem: 'npm', name: 'a', distribution_model: 'saas' },
        },
      },
      { a: 'MIT' },
    );
    expect(json.result.content[0].text).toContain('not legal advice');
  });
});

describe('tools/call — check_manifest_licenses', () => {
  it('マニフェスト全体を判定する', async () => {
    const { json } = await rpc(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'check_manifest_licenses',
          arguments: {
            content: JSON.stringify({
              dependencies: { a: '1.0.0', b: '1.0.0' },
              devDependencies: { c: '1.0.0' },
            }),
            distribution_model: 'saas',
          },
        },
      },
      { a: 'MIT', b: 'AGPL-3.0-only', c: 'AGPL-3.0-only' },
    );
    expect(json.result.structuredContent.summary.total).toBe(3);
    expect(json.result.structuredContent.summary.blocked).toBe(1);
    expect(json.result.content[0].text).toContain('Items requiring attention');
  });

  it('問題なしの場合はその旨を述べる', async () => {
    const { json } = await rpc(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'check_manifest_licenses',
          arguments: {
            content: JSON.stringify({ dependencies: { a: '1.0.0' } }),
            distribution_model: 'saas',
          },
        },
      },
      { a: 'MIT' },
    );
    expect(json.result.content[0].text).toContain('Nothing in this manifest obligates you');
  });
});

describe('tools/call — explain_license', () => {
  it('全配布モデルを説明する', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'explain_license', arguments: { license: 'AGPL-3.0-only' } },
    });
    expect(json.result.structuredContent.byDistributionModel).toHaveLength(5);
    expect(json.result.content[0].text).toContain('dev/build-only');
  });

  it('linkage 指定が LGPL の結論を変える', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'explain_license', arguments: { license: 'LGPL-3.0-only', linkage: 'static' } },
    });
    const rows = json.result.structuredContent.byDistributionModel;
    expect(rows.every((r: any) => r.verdict === 'review')).toBe(true);
  });
});

describe('エラー処理', () => {
  it('未知メソッドは -32601', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 9, method: 'resources/list' });
    expect(json.error.code).toBe(-32601);
  });

  it('未知ツールは -32602', async () => {
    const { json } = await rpc({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    });
    expect(json.error.code).toBe(-32602);
  });

  it('不正なJSONは -32700 と 400', async () => {
    const res = await handleMcpRequest(
      new Request('https://x/mcp', { method: 'POST', body: '{ broken' }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32700);
  });

  it('JSON-RPC 2.0 でないメッセージは -32600', async () => {
    const res = await handleMcpRequest(post({ method: 'ping' }), ctx());
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32600);
  });
});

describe('バッチ', () => {
  it('複数リクエストに配列で応答する', async () => {
    const { json } = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(2);
  });

  it('通知のみのバッチには 202 を返す', async () => {
    const res = await handleMcpRequest(
      post([{ jsonrpc: '2.0', method: 'notifications/initialized' }]),
      ctx(),
    );
    expect(res.status).toBe(202);
  });
});

describe('レート制限はコストのかかるツールにのみ適用する', () => {
  const limitedCtx = (calls: string[]) => ({
    cache,
    fetchers: fetchers({ a: 'MIT' }),
    rateLimit: async (w: 'heavy' | 'light') => {
      calls.push(w);
      return new Response('limited', { status: 429 });
    },
  });

  const noLimitCtx = (calls: string[]) => ({
    cache,
    fetchers: fetchers({ a: 'MIT' }),
    rateLimit: async (w: 'heavy' | 'light') => {
      calls.push(w);
      return null;
    },
  });

  const call = async (name: string, args: Record<string, unknown>, c: any) =>
    (await (await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      c,
    )).json()) as any;

  it('ping と tools/list は制限を消費しない', async () => {
    const calls: string[] = [];
    const c = noLimitCtx(calls);
    await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), c);
    await handleMcpRequest(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), c);
    expect(calls).toEqual([]);
  });

  it('explain_license は上流に触れないので制限しない', async () => {
    const calls: string[] = [];
    await call('explain_license', { license: 'MIT' }, noLimitCtx(calls));
    expect(calls).toEqual([]);
  });

  it('check_dependency_license は light を消費する', async () => {
    const calls: string[] = [];
    await call(
      'check_dependency_license',
      { ecosystem: 'npm', name: 'a', distribution_model: 'saas' },
      noLimitCtx(calls),
    );
    expect(calls).toEqual(['light']);
  });

  it('check_manifest_licenses は heavy を消費する', async () => {
    const calls: string[] = [];
    await call(
      'check_manifest_licenses',
      { content: '{"dependencies":{"a":"1.0.0"}}', distribution_model: 'saas' },
      noLimitCtx(calls),
    );
    expect(calls).toEqual(['heavy']);
  });

  it('制限に掛かったら isError で伝える（プロトコルエラーにしない）', async () => {
    const j = await call(
      'check_dependency_license',
      { ecosystem: 'npm', name: 'a', distribution_model: 'saas' },
      limitedCtx([]),
    );
    expect(j.result.isError).toBe(true);
    expect(j.result.content[0].text).toContain('Rate limit exceeded');
    expect(j.error).toBeUndefined();
  });

  it('rateLimit が無くても動作する', async () => {
    const j = await call(
      'check_dependency_license',
      { ecosystem: 'npm', name: 'a', distribution_model: 'saas' },
      { cache, fetchers: fetchers({ a: 'MIT' }) },
    );
    expect(j.result.structuredContent.verdict).toBe('allowed');
  });
});
