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
    expect(body.error).toContain('依存を検出できませんでした');
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
