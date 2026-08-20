import { describe, expect, it } from 'vitest';
import app from '../src/index';

/** D1Database の最小スタブ */
function fakeEnv() {
  const inserted: unknown[][] = [];
  return {
    inserted,
    env: {
      DB: {
        prepare() {
          return {
            bind(...args: unknown[]) {
              return {
                async first() {
                  return null;
                },
                async run() {
                  inserted.push(args);
                  return { success: true };
                },
              };
            },
          };
        },
      } as unknown as D1Database,
    },
  };
}

describe('app', () => {
  it('GET / はHTMLを返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('LicenseGuard');
  });

  it('GET /healthz は ok を返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/healthz', {}, env);
    expect(res.status).toBe(200);
  });

  it('POST /api/scan は content 未指定で 400', async () => {
    const { env } = fakeEnv();
    const res = await app.request(
      '/api/scan',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ distributionModel: 'saas' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('POST /api/scan は不正な配布モデルで 400', async () => {
    const { env } = fakeEnv();
    const res = await app.request(
      '/api/scan',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '{"dependencies":{}}', distributionModel: 'nonsense' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('POST /api/scan はパース不能な入力で 400 とメッセージを返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request(
      '/api/scan',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '!!!!!', distributionModel: 'saas' }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('No dependencies were found');
  });

  it('POST /api/scan は 100KB を超える入力を 413 で拒否する', async () => {
    const { env } = fakeEnv();
    const res = await app.request(
      '/api/scan',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x'.repeat(100_001), distributionModel: 'saas' }),
      },
      env,
    );
    expect(res.status).toBe(413);
  });

  it('POST /api/track はイベントを記録して 204 を返す', async () => {
    const { env, inserted } = fakeEnv();
    const res = await app.request(
      '/api/track',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'cta_paid_report_clicked', sessionId: 'abc' }),
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
  });

  it('POST /api/track は不正なイベント名を無視して 204 を返す', async () => {
    const { env, inserted } = fakeEnv();
    const res = await app.request(
      '/api/track',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(200), sessionId: 'abc' }),
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(0);
  });
});

describe('SEO ルート', () => {
  it('GET /licenses は一覧を返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/licenses', {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('/license/AGPL-3.0-only');
  });

  it('GET /license/:id は既知ライセンスのページを返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/license/AGPL-3.0-only', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage');
    expect(await res.text()).toContain('section 13');
  });

  it('GET /license/:id は未知IDで 404', async () => {
    const { env } = fakeEnv();
    expect((await app.request('/license/NOPE-9000', {}, env)).status).toBe(404);
  });

  it('GET /robots.txt は sitemap を指す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/robots.txt', {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Sitemap:');
  });

  it('GET /sitemap.xml は XML を返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/sitemap.xml', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('xml');
    expect(await res.text()).toContain('<urlset');
  });

  it('GET /sitemap.xml は DB 障害時もシードで応答する', async () => {
    const env = {
      DB: {
        prepare() {
          return {
            async all() {
              throw new Error('db down');
            },
          };
        },
      } as unknown as D1Database,
    };
    const res = await app.request('/sitemap.xml', {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('/pkg/npm/express');
  });

  it('GET /pkg/:eco/:name は未知エコシステムで 404', async () => {
    const { env } = fakeEnv();
    expect((await app.request('/pkg/maven/foo', {}, env)).status).toBe(404);
  });
});

describe('エージェント向けルート', () => {
  it('GET /llms.txt は MCP と API を先頭に案内する', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/llms.txt', {}, env);
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toContain('## For agents');
    expect(txt).toContain('claude mcp add licenseguard');
    expect(txt).toContain('/api/pkg/');
    expect(txt).toContain('not legal advice');
    // AGPL と GPL の違いという最も混同されやすい事実を明示する
    expect(txt).toContain('section 13');
  });

  it('executionCtx が無い環境でも /mcp が動く', async () => {
    // waitUntil を取れない実行環境で例外にしないことの確認
    const { env } = fakeEnv();
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      },
      env,
    );
    expect(res.status).toBe(200);
  });

  it('POST /mcp は initialize に応答する', async () => {
    const { env } = fakeEnv();
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18' },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.result.serverInfo.name).toBe('licenseguard');
  });

  it('GET /mcp は 405（SSE非提供）', async () => {
    const { env } = fakeEnv();
    expect((await app.request('/mcp', {}, env)).status).toBe(405);
  });

  it('POST /mcp は tools/list を返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      },
      env,
    );
    const json = (await res.json()) as any;
    expect(json.result.tools).toHaveLength(3);
  });

  it('GET /api/pkg は不正な model を 400 にする', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/api/pkg/npm/express?model=nonsense', {}, env);
    expect(res.status).toBe(400);
  });

  it('GET /api/pkg は未知エコシステムを 404 にする', async () => {
    const { env } = fakeEnv();
    expect((await app.request('/api/pkg/maven/foo', {}, env)).status).toBe(404);
  });

  it('robots.txt が API を除外していても llms.txt は許可される', async () => {
    const { env } = fakeEnv();
    const txt = await (await app.request('/robots.txt', {}, env)).text();
    expect(txt).toContain('Disallow: /api/');
    expect(txt).not.toContain('Disallow: /llms.txt');
  });
});
