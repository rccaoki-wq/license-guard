// 無料Webツールをブラウザで実際に動かす。
// これまで HTML を文字列として検査しただけで、JS が動くか未確認だった。
import { chromium } from 'playwright';
import { SYNTHETIC_HEADERS } from './synthetic.mjs';

const BASE = process.env.BASE || 'https://license-guard.rcc-aoki.workers.dev';
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ extraHTTPHeaders: SYNTHETIC_HEADERS });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });

check('ページが表示される', (await page.title()).includes('LicenseGuard'));
check('スキャンボタンがある', await page.locator('#run').isVisible());
check('結果は初期状態で隠れている', !(await page.locator('#result').isVisible()));

// 空入力のバリデーション
await page.click('#run');
await page.waitForTimeout(300);
check('空入力でエラー表示', await page.locator('#error').isVisible(),
  (await page.locator('#error').textContent()) || '');

// 実際のスキャン（AGPL が blocked になること）
await page.fill('#content', JSON.stringify({
  dependencies: { express: '4.18.2' },
  devDependencies: { typescript: '^5.6.0' },
}));
await page.selectOption('#model', 'saas');
await page.click('#run');
await page.waitForSelector('#result:not(.hidden)', { timeout: 60000 });

const findings = await page.locator('.f').count();
check('結果が描画される', findings === 2, `${findings} 件`);
check('サマリーが出る', (await page.locator('.chip').count()) === 3);
check('限界の説明が出る', (await page.locator('#limits').textContent()).includes('direct dependencies'));

const firstText = await page.locator('.f').first().textContent();
check('判定理由が本文に含まれる', firstText.length > 80);

// パッケージページへのリンク
const href = await page.locator('.f h3 a').first().getAttribute('href');
check('パッケージページへリンクする', href && href.startsWith('/pkg/'), href || '');

// CTA と計測
const [trackReq] = await Promise.all([
  page.waitForRequest((r) => r.url().includes('/api/track') && r.postData()?.includes('cta_paid_report_clicked'), { timeout: 10000 }),
  page.click('#cta-paid-report'),
]);
check('CTA クリックが計測に送られる', !!trackReq);
await page.waitForTimeout(300);
// クリック数だけでは支払意思を測れないため、押すと連絡先の入力を求める。
// 詳しい検証は e2e/interest.spec.mjs 側で行う
check('CTA クリックで連絡先フォームが出る', await page.locator('#cta-form').isVisible());

// 配布モデルを変えると判定が変わる（AGPL）
await page.fill('#content', JSON.stringify({ dependencies: { 'pyload-ng': '' } }));
await page.fill('#content', 'pyload-ng\n');
await page.selectOption('#model', 'saas');
await page.click('#run');
await page.waitForTimeout(6000);
const saasBlocked = (await page.locator('.f.blocked').count()) > 0;
await page.selectOption('#model', 'internal-only');
await page.click('#run');
await page.waitForTimeout(6000);
const internalBlocked = (await page.locator('.f.blocked').count()) > 0;
check('配布モデルの切替が判定を変える', saasBlocked && !internalBlocked,
  `saas=${saasBlocked ? 'blocked' : 'ok'} internal=${internalBlocked ? 'blocked' : 'ok'}`);

check('JSコンソールエラーが無い', consoleErrors.length === 0, consoleErrors.join(' | '));

// モバイル幅で横スクロールが出ないこと
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('モバイル幅で横スクロールしない', !overflow);

await browser.close();
console.log(failures === 0 ? '\nブラウザ検証: 全て通過' : `\nブラウザ検証: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
