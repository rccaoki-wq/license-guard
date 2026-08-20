import { Hono, type Context } from 'hono';
import { renderPage } from './ui/page';
import { renderLicenseIndex, renderLicensePage } from './ui/license';
import { renderPackageNotFound, renderPackagePage } from './ui/pkg';
import { scan } from './scan';
import { LicenseCache } from './resolver/cache';
import { LicenseResolver } from './resolver';
import { findLicense } from './seo/catalog';
import { buildRobotsTxt, buildSitemap, type SitemapPackage } from './seo/sitemap';
import type { DistributionModel, Ecosystem } from './types';

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

const ECOSYSTEMS: readonly Ecosystem[] = ['npm', 'pypi', 'go'];

const TRACKED_EVENTS = new Set([
  'scan_submitted',
  'scan_succeeded',
  'scan_failed',
  'cta_paid_report_clicked',
]);

/** SEO ページはエッジで長めにキャッシュする */
const SEO_CACHE = 'public, max-age=3600, s-maxage=86400';

app.get('/', (c) => c.html(renderPage(), 200, { 'cache-control': 'public, max-age=300' }));

app.get('/healthz', (c) => c.json({ ok: true }));

app.get('/robots.txt', (c) =>
  c.text(buildRobotsTxt(), 200, { 'cache-control': SEO_CACHE }),
);

app.get('/licenses', (c) =>
  c.html(renderLicenseIndex(), 200, { 'cache-control': SEO_CACHE }),
);

app.get('/license/:id', (c) => {
  const entry = findLicense(c.req.param('id'));
  if (!entry) return c.notFound();
  return c.html(renderLicensePage(entry), 200, { 'cache-control': SEO_CACHE });
});

app.get('/sitemap.xml', async (c) => {
  let packages: SitemapPackage[] = [];
  try {
    // 解決実績のあるパッケージのみ載せる。ページに中身があることが保証されるため。
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT ecosystem, package FROM license_cache
       WHERE spdx IS NOT NULL ORDER BY package LIMIT 45000`,
    ).all<{ ecosystem: string; package: string }>();

    packages = (rows.results ?? [])
      .filter((r): r is { ecosystem: Ecosystem; package: string } =>
        ECOSYSTEMS.includes(r.ecosystem as Ecosystem),
      )
      .map((r) => ({ ecosystem: r.ecosystem, name: r.package }));
  } catch {
    // DB 障害時もシードのみで sitemap を返す
  }

  return c.text(buildSitemap(packages), 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': SEO_CACHE,
  });
});

/**
 * パッケージページ。要求時にライセンスを解決して生成する。
 * Go はモジュールパスにスラッシュを含むため末尾をワイルドカードで受ける。
 */
async function packageRoute(
  c: Context<Env>,
  ecosystem: Ecosystem,
  name: string,
): Promise<Response> {
  if (name === '' || name.length > 214) return c.notFound();

  const cache = new LicenseCache(c.env.DB);
  const resolver = new LicenseResolver(cache);
  const { spdx } = await resolver.resolve({ ecosystem, name, version: null, scope: 'runtime' });

  if (spdx === null) {
    return c.html(renderPackageNotFound(ecosystem, name), 200, {
      // 解決できなかった結果は短めにしておき、後で解決できたら早く反映されるようにする
      'cache-control': 'public, max-age=300',
    });
  }

  return c.html(renderPackagePage({ ecosystem, name, spdx }), 200, {
    'cache-control': SEO_CACHE,
  });
}

app.get('/pkg/go/*', (c) => {
  const name = decodeURIComponent(c.req.path.slice('/pkg/go/'.length));
  return packageRoute(c, 'go', name);
});

app.get('/pkg/:ecosystem/:name', (c) => {
  const ecosystem = c.req.param('ecosystem') as Ecosystem;
  if (!ECOSYSTEMS.includes(ecosystem)) return c.notFound();
  return packageRoute(c, ecosystem, c.req.param('name'));
});

app.post('/api/scan', async (c) => {
  let body: { content?: unknown; distributionModel?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body is not valid JSON.' }, 400);
  }

  const { content, distributionModel } = body;

  if (typeof content !== 'string' || content.trim() === '') {
    return c.json({ error: 'content is required.' }, 400);
  }

  // D1 の 1 ステートメント上限と処理時間の両方を考慮した入力上限。
  // UTF-8 バイト数で計測する（String.length は UTF-16 単位のため過小評価となる）
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return c.json({ error: 'Input is too large (100KB limit).' }, 413);
  }

  if (!DISTRIBUTION_MODELS.includes(distributionModel as DistributionModel)) {
    return c.json({ error: 'Unknown distribution model.' }, 400);
  }

  const cache = new LicenseCache(c.env.DB);

  try {
    const result = await scan(content, distributionModel as DistributionModel, cache);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Check failed.' }, 400);
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
