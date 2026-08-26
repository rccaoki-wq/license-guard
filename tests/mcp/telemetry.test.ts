import { describe, expect, it, vi } from 'vitest';
import { handleMcpRequest } from '../../src/mcp/handler';
import { createD1Recorder, type McpEvent } from '../../src/mcp/telemetry';
import type { CacheLike } from '../../src/resolver';

const cache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

const fetchers = (map: Record<string, string | null>) => {
  const look = async (n: string) => ({ spdx: map[n] ?? null });
  return { npm: look, pypi: look, go: look, cargo: look, rubygems: look, nuget: look };
};

function post(body: unknown) {
  return new Request('https://license-guard.rcc-aoki.workers.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function withRecorder(map: Record<string, string | null> = {}) {
  const events: McpEvent[] = [];
  return {
    events,
    ctx: { cache, fetchers: fetchers(map), record: (e: McpEvent) => events.push(e) },
  };
}

describe('MCP 計測', () => {
  it('initialize でクライアント名とバージョンを記録する', async () => {
    const { events, ctx } = withRecorder();
    await handleMcpRequest(
      post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code', version: '2.0' } },
      }),
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'initialize',
      clientName: 'claude-code',
      clientVersion: '2.0',
    });
    // 発行したセッション ID が記録側にも載る（これが無いと tool_call と結合できない）
    expect(events[0]!.sessionId).toMatch(/^[\x21-\x7e]+$/);
  });

  it('tool_call でツール・エコシステム・配布モデル・判定を記録する', async () => {
    const { events, ctx } = withRecorder({ 'agpl-lib': 'AGPL-3.0-only' });
    await handleMcpRequest(
      post({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: { ecosystem: 'npm', name: 'agpl-lib', distribution_model: 'saas' },
        },
      }),
      ctx,
    );
    expect(events[0]).toEqual({
      event: 'tool_call',
      tool: 'check_dependency_license',
      ecosystem: 'npm',
      distributionModel: 'saas',
      verdict: 'blocked',
    });
  });

  it('パッケージ名を記録しない（プライバシー方針）', async () => {
    const { events, ctx } = withRecorder({ 'internal-secret-pkg': 'MIT' });
    await handleMcpRequest(
      post({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: {
            ecosystem: 'npm',
            name: 'internal-secret-pkg',
            distribution_model: 'saas',
          },
        },
      }),
      ctx,
    );
    expect(JSON.stringify(events)).not.toContain('internal-secret-pkg');
  });

  it('マニフェスト本文を記録しない（プライバシー方針）', async () => {
    const { events, ctx } = withRecorder({ 'acme-internal-billing': 'MIT' });
    await handleMcpRequest(
      post({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'check_manifest_licenses',
          arguments: {
            content: JSON.stringify({ dependencies: { 'acme-internal-billing': '1.0.0' } }),
            distribution_model: 'saas',
          },
        },
      }),
      ctx,
    );
    expect(JSON.stringify(events)).not.toContain('acme-internal-billing');
    expect(events[0]!.tool).toBe('check_manifest_licenses');
  });

  it('ツールがエラーを返した場合は verdict を error にする', async () => {
    const { events, ctx } = withRecorder();
    await handleMcpRequest(
      post({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'check_dependency_license',
          arguments: { ecosystem: 'maven', name: 'x', distribution_model: 'saas' },
        },
      }),
      ctx,
    );
    expect(events[0]!.verdict).toBe('error');
  });

  it('recorder 無しでもサーバーは動作する', async () => {
    const res = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
      { cache },
    );
    expect(res.status).toBe(200);
  });

  it('ping は記録しない（ノイズになるため）', async () => {
    const { events, ctx } = withRecorder();
    await handleMcpRequest(post({ jsonrpc: '2.0', id: 6, method: 'ping' }), ctx);
    expect(events).toHaveLength(0);
  });
});

describe('createD1Recorder', () => {
  function fakeDb() {
    const rows: unknown[][] = [];
    return {
      rows,
      db: {
        prepare() {
          return {
            bind(...args: unknown[]) {
              return {
                async run() {
                  rows.push(args);
                  return { success: true };
                },
              };
            },
          };
        },
      } as unknown as D1Database,
    };
  }

  it('waitUntil に Promise を渡して応答をブロックしない', () => {
    const { db, rows } = fakeDb();
    const waitUntil = vi.fn();
    createD1Recorder(db, waitUntil)({ event: 'initialize', clientName: 'x' });
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
  });

  it('長い値を刈り込む', async () => {
    const { db, rows } = fakeDb();
    createD1Recorder(db)({ event: 'initialize', clientName: 'x'.repeat(500) });
    expect((rows[0]![5] as string).length).toBe(64);
  });

  it('DB 障害を握りつぶす', () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                throw new Error('db down');
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    expect(() => createD1Recorder(db)({ event: 'initialize' })).not.toThrow();
  });
});
