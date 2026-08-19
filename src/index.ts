import { Hono } from 'hono';
import { renderPage } from './ui/page';
import { scan } from './scan';
import { LicenseCache } from './resolver/cache';
import type { DistributionModel } from './types';

type Env = { Bindings: { DB: D1Database } };

const app = new Hono<Env>();

const MAX_CONTENT_BYTES = 100_000;

const DISTRIBUTION_MODELS: readonly DistributionModel[] = [
  'saas',
  'distributed-binary',
  'on-prem-delivery',
  'internal-only',
  'library-published',
];

const TRACKED_EVENTS = new Set([
  'scan_submitted',
  'scan_succeeded',
  'scan_failed',
  'cta_paid_report_clicked',
]);

app.get('/', (c) =>
  c.html(renderPage(), 200, {
    'cache-control': 'public, max-age=300',
  }),
);

app.get('/healthz', (c) => c.json({ ok: true }));

app.post('/api/scan', async (c) => {
  let body: { content?: unknown; distributionModel?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'リクエストボディが JSON として解釈できません。' }, 400);
  }

  const { content, distributionModel } = body;

  if (typeof content !== 'string' || content.trim() === '') {
    return c.json({ error: 'content は必須です。' }, 400);
  }

  // D1 の 1 ステートメント上限と処理時間の両方を考慮した入力上限。
  // UTF-8 バイト数で計測する（String.length は UTF-16 単位のため過小評価となる）
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return c.json({ error: '入力が大きすぎます（上限 100KB）。' }, 413);
  }

  if (!DISTRIBUTION_MODELS.includes(distributionModel as DistributionModel)) {
    return c.json({ error: '配布モデルの指定が不正です。' }, 400);
  }

  const cache = new LicenseCache(c.env.DB);

  try {
    const result = await scan(content, distributionModel as DistributionModel, cache);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : '判定に失敗しました。' }, 400);
  }
});

app.post('/api/track', async (c) => {
  try {
    const { name, sessionId } = (await c.req.json()) as {
      name?: unknown;
      sessionId?: unknown;
    };

    if (typeof name === 'string' && TRACKED_EVENTS.has(name) && typeof sessionId === 'string') {
      await c.env.DB.prepare(
        'INSERT INTO events (name, session_id, payload, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(name, sessionId.slice(0, 64), null, Date.now())
        .run();
    }
  } catch {
    // 計測の失敗はユーザー体験に影響させない
  }

  return c.body(null, 204);
});

export default app;
