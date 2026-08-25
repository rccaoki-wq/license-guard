import { Hono, type Context } from 'hono';
import { renderPage } from './ui/page';
import { renderLicenseIndex, renderLicensePage } from './ui/license';
import { findPair, renderCompareIndex, renderComparePage } from './ui/compare';
import { renderPackageNotFound, renderPackagePage } from './ui/pkg';
import { renderPackageIndex } from './ui/packages';
import { scan, withProvenanceNote } from './scan';
import { LicenseCache } from './resolver/cache';
import { LicenseResolver } from './resolver';
import { findLicense } from './seo/catalog';
import { renderLicenseResource } from './mcp/resources';
import { buildRobotsTxt, buildSitemap } from './seo/sitemap';
import { listPackageIndex, recordPackagePage } from './seo/package-index';
import { buildLlmsTxt } from './seo/llms';
import { handleMcpRequest } from './mcp/handler';
import { createD1Recorder, isSyntheticRequest } from './mcp/telemetry';
import { enforceRateLimit, type RateLimitBinding } from './ratelimit';
import { isPlausibleEmail, normalizeEmail } from './interest';
import { classifyClient } from './client-kind';
import { buildPageView, recordPageView } from './page-views';
import { evaluateExpression } from './policy/engine';
import { packagePath } from './ui/pkg';
import { SITE_ORIGIN } from './ui/layout';
import { FAVICON_SVG } from './ui/favicon';
import { INDEXNOW_KEY, INDEXNOW_KEY_PATH } from './seo/indexnow';
import { ECOSYSTEMS } from './types';
import type { DistributionModel, Ecosystem, Linkage, Scope } from './types';

type Env = {
  Bindings: {
    DB: D1Database;
    /** レート制限バインディング。未設定の環境では素通りする */
    SCAN_LIMITER?: RateLimitBinding;
    API_LIMITER?: RateLimitBinding;
  };
};

const app = new Hono<Env>();

/**
 * ページ到達をサーバ側で数える。
 *
 * ここに置く理由。到達計測はレイアウトの任意 script として渡す作りで、
 * 渡していたのはトップページだけだった。検索向けの 874 枚は 1 件も
 * 記録されておらず、「人間の到達 3 件」は実際には「トップに来た 3 人」
 * でしかなかった。ページごとに書き足す方式は同じ抜けをまた作るので、
 * 経路に置いて個別のページの都合から外す。
 *
 * 応答は絶対に止めない。計測はレスポンスを返した後に waitUntil で流す。
 */
app.use('*', async (c, next) => {
  await next();
  try {
    const row = buildPageView(
      {
        path: c.req.path,
        status: c.res.status,
        contentType: c.res.headers.get('content-type'),
      },
      {
        userAgent: c.req.header('user-agent'),
        referer: c.req.header('referer') ?? c.req.header('referrer'),
        synthetic: isSyntheticRequest(c.req.raw.headers),
      },
      new URL(c.req.url).hostname,
      Date.now(),
    );
    if (!row) return;

    const write = recordPageView(c.env.DB, row).catch(() => {});
    const later = safeWaitUntil(c);
    if (later) later(write);
    else await write;
  } catch {
    // 計測の失敗をページの失敗にしない
  }
});

/**
 * 本文サイズの上限。
 *
 * 実在するプロジェクトの package-lock.json は数百KB から数MB になる
 * （本プロジェクト自身でも 162KB）。JSON のパースは安価で、費用がかかる
 * のは外部照会の方なので、そちらを MAX_LOOKUPS で抑える。
 */
const MAX_CONTENT_BYTES = 4_000_000;

const DISTRIBUTION_MODELS: readonly DistributionModel[] = [
  'saas',
  'distributed-binary',
  'on-prem-delivery',
  'internal-only',
  'library-published',
];


/**
 * エコシステムごとのパッケージ名の形。
 *
 * 検証しないと任意の文字列が 200 を返し、意味のないページと無駄な外部
 * リクエストでクロール空間が無限に広がる。Go はスキーム付きの入力
 * （"https://evil.com/x"）も弾く必要がある。
 */
const NAME_PATTERN: Record<Ecosystem, RegExp> = {
  // スコープ付き（@scope/name）を含む npm の名前
  npm: /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._~-]*$/,
  pypi: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  go: /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/[A-Za-z0-9._~-]+)*$/i,
  cargo: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
};

function isValidPackageName(ecosystem: Ecosystem, name: string): boolean {
  if (name === '' || name.length > 214) return false;
  return NAME_PATTERN[ecosystem].test(name);
}

/** URL のパーセントデコード。不正な並びで例外を投げさせない */
function safeDecode(v: string): string | null {
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
}

const TRACKED_EVENTS = new Set([
  // 到達。これが無いと「誰も来ていない」と「来たが何もせず帰った」を
  // 区別できず、流入を作るべきか入口を直すべきか判断できない
  'landed',
  'example_loaded',
  'scan_submitted',
  'scan_succeeded',
  'scan_failed',
  'cta_paid_report_clicked',
  'cta_email_submitted',
]);

/** SEO ページはエッジで長めにキャッシュする */
const SEO_CACHE = 'public, max-age=3600, s-maxage=86400';

const DISCLAIMER =
  'Informational only, not legal advice. Based on declared license metadata; copied code fragments are not detected.';

app.get('/', (c) => c.html(renderPage(), 200, { 'cache-control': 'public, max-age=300' }));

app.get('/healthz', (c) =>
  c.json({
    ok: true,
    // どの保護が有効かを可視化する。秘匿情報は含まない
    bindings: {
      db: typeof c.env.DB?.prepare === 'function',
      scanLimiter: typeof c.env.SCAN_LIMITER?.limit === 'function',
      apiLimiter: typeof c.env.API_LIMITER?.limit === 'function',
    },
  }),
);


app.get('/robots.txt', (c) =>
  c.text(buildRobotsTxt(), 200, { 'cache-control': SEO_CACHE }),
);

// IndexNow の所有証明。中身は鍵そのもの（仕様）
app.get(INDEXNOW_KEY_PATH, (c) =>
  c.text(INDEXNOW_KEY, 200, { 'cache-control': SEO_CACHE }),
);

// カタログ（Docker Desktop / Glama / mcp.so）はアイコン URL を直接参照する
app.get('/favicon.svg', (c) =>
  c.body(FAVICON_SVG, 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400, s-maxage=604800',
  }),
);

app.get('/llms.txt', (c) =>
  c.text(buildLlmsTxt(), 200, { 'cache-control': SEO_CACHE }),
);

// --- MCP: ステートレス Streamable HTTP エンドポイント ---

/**
 * executionCtx は実行環境によっては存在せず、参照するだけで例外になる。
 * 取れなければ waitUntil 無しに落とす（計測は同期的に走るだけで、機能は保たれる）。
 */
function safeWaitUntil(c: Context<Env>): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ec = c.executionCtx;
    return (p) => ec.waitUntil(p);
  } catch {
    return undefined;
  }
}

app.all('/mcp', (c) =>
  // エンドポイント全体ではなくツール単位で制限する。ping や tools/list、
  // explain_license は上流に触れないため制限すると正当な利用を妨げるだけ。
  handleMcpRequest(c.req.raw, {
    cache: new LicenseCache(c.env.DB),
    record: createD1Recorder(c.env.DB, safeWaitUntil(c)),
    rateLimit: (weight) =>
      enforceRateLimit(
        weight === 'heavy' ? c.env.SCAN_LIMITER : c.env.API_LIMITER,
        c.req.raw,
      ),
  }),
);

// --- 機械可読 API ---

const SCOPES: readonly Scope[] = ['runtime', 'dev', 'build', 'test', 'optional'];
const API_LINKAGE: Record<Ecosystem, Linkage> = {
  npm: 'dynamic',
  pypi: 'dynamic',
  go: 'static',
  cargo: 'static',
};

async function packageApi(
  c: Context<Env>,
  ecosystem: Ecosystem,
  name: string,
): Promise<Response> {
  // 1 パッケージのみなので上限は緩め
  const limited = await enforceRateLimit(c.env.API_LIMITER, c.req.raw);
  if (limited) return limited;

  const model = (c.req.query('model') ?? 'saas') as DistributionModel;
  const scope = (c.req.query('scope') ?? 'runtime') as Scope;
  const version = c.req.query('version') ?? null;

  if (!DISTRIBUTION_MODELS.includes(model)) {
    return c.json({ error: `model must be one of: ${DISTRIBUTION_MODELS.join(', ')}` }, 400);
  }
  if (!SCOPES.includes(scope)) {
    return c.json({ error: `scope must be one of: ${SCOPES.join(', ')}` }, 400);
  }
  const resolver = new LicenseResolver(new LicenseCache(c.env.DB));
  const { spdx, resolvedFrom } = await resolver.resolve({ ecosystem, name, version, scope });
  const reference = SITE_ORIGIN + packagePath(ecosystem, name);

  if (resolvedFrom === 'unresolved') {
    return c.json(
      {
        package: { ecosystem, name, version },
        license: null,
        licenseSource: resolvedFrom,
        distributionModel: model,
        scope,
        verdict: 'review',
        obligations: [],
        rationale:
          'The license could not be determined. Either none is declared, or the registry did not return one. A package genuinely published without a license is all rights reserved by default.',
        reference,
        disclaimer: DISCLAIMER,
      },
      200,
      { 'cache-control': 'public, max-age=300' },
    );
  }

  const r = withProvenanceNote(
    evaluateExpression(spdx, {
      scope,
      linkage: API_LINKAGE[ecosystem],
      distributionModel: model,
    }),
    resolvedFrom,
  );

  return c.json(
    {
      package: { ecosystem, name, version },
      license: spdx,
      licenseSource: resolvedFrom,
      distributionModel: model,
      scope,
      verdict: r.verdict,
      obligations: r.obligations,
      rationale: r.rationale,
      // 宣言が版を欠いていて補った場合のみ。rationale は補った後の識別子で
      // 書かれているので、これが無いと呼び出し側は補われたことに気づけない
      ...(r.assumption ? { assumption: r.assumption } : {}),
      reference,
      disclaimer: DISCLAIMER,
    },
    200,
    { 'cache-control': SEO_CACHE },
  );
}

/**
 * 名前にスラッシュを含む形（npm のスコープ付き、Go のモジュールパス）を
 * リテラルのまま受けたいので、末尾はワイルドカードで取る。
 * パーセントエンコード形式も同じ経路で扱える。
 */
app.get('/api/pkg/:ecosystem/*', (c) => {
  const ecosystem = c.req.param('ecosystem') as Ecosystem;
  if (!ECOSYSTEMS.includes(ecosystem)) return c.notFound();

  const name = safeDecode(c.req.path.slice(`/api/pkg/${ecosystem}/`.length));
  if (name === null) return c.json({ error: 'Malformed URL encoding.' }, 400);
  if (!isValidPackageName(ecosystem, name)) {
    return c.json({ error: `Not a valid ${ecosystem} package name.` }, 400);
  }
  return packageApi(c, ecosystem, name);
});

app.get('/licenses', (c) =>
  c.html(renderLicenseIndex(), 200, { 'cache-control': SEO_CACHE }),
);

// 比較ページ。「AGPL と GPL は何が違うのか」が問いの自然な形なので、
// その形のまま答えられる場所を用意する
app.get('/compare', (c) =>
  c.html(renderCompareIndex(), 200, { 'cache-control': SEO_CACHE }),
);

app.get('/compare/:slug', (c) => {
  const raw = c.req.param('slug');
  const at = raw.toLowerCase().indexOf('-vs-');
  if (at < 0) return c.notFound();

  const pair = findPair(raw.slice(0, at), raw.slice(at + 4));
  if (!pair) return c.notFound();

  const html = renderComparePage(pair);
  if (html === null) return c.notFound();
  return c.html(html, 200, { 'cache-control': SEO_CACHE });
});

// ライセンスページ。拡張子で形式を選ぶ。
//
// **経路を2本に分けない。** 当初 `/license/:id.md` を別ルートにしたところ、
// Hono のパターンが `/license/MIT` にも一致し、HTML ページが Markdown を
// 返すようになっていた。テストが無ければ本体を壊したまま公開していた。
//
// Markdown を出す理由は、AI に取得させるときに HTML から本文を抜き出させると
// ナビゲーションや免責が混ざるため。MCP のリソースと同じ生成物を返すので、
// 経路が増えても答えは1つのまま。
app.get('/license/:id', (c) => {
  const raw = c.req.param('id');
  const wantsMarkdown = raw.toLowerCase().endsWith('.md');
  const id = wantsMarkdown ? raw.slice(0, -3) : raw;

  const entry = findLicense(id);
  if (!entry) return c.notFound();

  if (wantsMarkdown) {
    const md = renderLicenseResource(entry.id);
    if (md === null) return c.notFound();
    return c.text(md, 200, {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': SEO_CACHE,
    });
  }

  return c.html(renderLicensePage(entry), 200, { 'cache-control': SEO_CACHE });
});

// `/pkg/*` の親。sitemap に載せるだけでは巡回されなかったので、
// 辿れる場所を作る（詳細は ui/packages.ts）。
app.get('/packages', async (c) =>
  c.html(renderPackageIndex(await listPackageIndex(c.env.DB)), 200, {
    'cache-control': SEO_CACHE,
  }),
);

app.get('/sitemap.xml', async (c) => {
  const packages = await listPackageIndex(c.env.DB);

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
  const cache = new LicenseCache(c.env.DB);
  const resolver = new LicenseResolver(cache);
  const { spdx } = await resolver.resolve({ ecosystem, name, version: null, scope: 'runtime' });

  if (spdx === null) {
    return c.html(renderPackageNotFound(ecosystem, name), 200, {
      // 解決できなかった結果は短めにしておき、後で解決できたら早く反映されるようにする
      'cache-control': 'public, max-age=300',
    });
  }

  // 索引に載せる。**license_cache には入らない**（版が null の依存は
  // 鍵が作れないので put が何もしない）ため、ここで載せないとこのページは
  // 一覧にも sitemap にも永久に出てこない。応答は待たせない
  const record = recordPackagePage(c.env.DB, ecosystem, name, spdx);
  const waitUntil = safeWaitUntil(c);
  if (waitUntil) waitUntil(record);
  else await record;

  return c.html(renderPackagePage({ ecosystem, name, spdx }), 200, {
    'cache-control': SEO_CACHE,
  });
}

app.get('/pkg/:ecosystem/*', (c) => {
  const ecosystem = c.req.param('ecosystem') as Ecosystem;
  if (!ECOSYSTEMS.includes(ecosystem)) return c.notFound();

  const name = safeDecode(c.req.path.slice(`/pkg/${ecosystem}/`.length));
  if (name === null || !isValidPackageName(ecosystem, name)) return c.notFound();
  return packageRoute(c, ecosystem, name);
});

app.post('/api/scan', async (c) => {
  // 1 リクエストで最大 200 依存を解決しうる、最も重い経路
  const limited = await enforceRateLimit(c.env.SCAN_LIMITER, c.req.raw);
  if (limited) return limited;

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
    return c.json({ error: 'Input is too large (4MB limit).' }, 413);
  }

  if (!DISTRIBUTION_MODELS.includes(distributionModel as DistributionModel)) {
    // 有効な値を挙げずに拒否すると、当てるまで叩かせることになる。
    // 同じ検証が 231 行目では既に列挙していた
    return c.json(
      { error: `Unknown distribution model. Must be one of: ${DISTRIBUTION_MODELS.join(', ')}` },
      400,
    );
  }

  const cache = new LicenseCache(c.env.DB);

  try {
    const result = await scan(content, distributionModel as DistributionModel, cache);
    // 法的リスクの観点から、機械可読な出力にも必ず免責を載せる
    return c.json({ ...result, disclaimer: DISCLAIMER });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Check failed.' }, 400);
  }
});

/**
 * 有料レポートへの関心表明。
 *
 * クリック数だけでは支払意思を測れないため、連絡先を受け付ける。
 * 保存するのは連絡先と、その人が見た判定の集計・選んでいた配布モデルだけ。
 * パッケージ名とマニフェスト本文は保存しない。
 */
app.post('/api/interest', async (c) => {
  const limited = await enforceRateLimit(c.env.API_LIMITER, c.req.raw);
  if (limited) return limited;

  let body: { email?: unknown; verdictMix?: unknown; distributionModel?: unknown; note?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body is not valid JSON.' }, 400);
  }

  const raw = typeof body.email === 'string' ? body.email : '';
  if (!isPlausibleEmail(raw)) {
    return c.json({ error: 'That does not look like an email address.' }, 400);
  }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;

  try {
    await c.env.DB.prepare(
      `INSERT INTO interest_signals
         (email, verdict_mix, distribution_model, note, synthetic, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET
         verdict_mix = excluded.verdict_mix,
         distribution_model = excluded.distribution_model,
         note = COALESCE(excluded.note, interest_signals.note),
         synthetic = excluded.synthetic,
         created_at = excluded.created_at`,
    )
      .bind(
        normalizeEmail(raw),
        str(body.verdictMix, 64),
        str(body.distributionModel, 32),
        str(body.note, 500),
        isSyntheticRequest(c.req.raw.headers) ? 1 : 0,
        Date.now(),
      )
      .run();
  } catch {
    return c.json({ error: 'Could not record that right now. Please try again later.' }, 503);
  }

  return c.json({ ok: true });
});

app.post('/api/track', async (c) => {
  try {
    const { name, sessionId } = (await c.req.json()) as {
      name?: unknown;
      sessionId?: unknown;
    };

    if (typeof name === 'string' && TRACKED_EVENTS.has(name) && typeof sessionId === 'string') {
      await c.env.DB.prepare(
        'INSERT INTO events (name, session_id, payload, synthetic, client_kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(
          name,
          sessionId.slice(0, 64),
          null,
          isSyntheticRequest(c.req.raw.headers) ? 1 : 0,
          // 生の User-Agent は保存しない。bot/browser/unknown の別だけ
          classifyClient(c.req.header('user-agent')),
          Date.now(),
        )
        .run();
    }
  } catch {
    // 計測の失敗はユーザー体験に影響させない
  }

  return c.body(null, 204);
});

export default app;
