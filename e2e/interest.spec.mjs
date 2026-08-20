// 関心表明の受け付け。Phase 0 の測定はここが機能して初めて意味を持つ。
import { chromium } from 'playwright';
import { SYNTHETIC_HEADERS } from './synthetic.mjs';
const B = process.env.BASE || 'https://license-guard.rcc-aoki.workers.dev';
let fail = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++; };

const browser = await chromium.launch();
const page = await browser.newPage({ extraHTTPHeaders: SYNTHETIC_HEADERS });
await page.goto(B, { waitUntil: 'domcontentloaded' });

await page.fill('#content', 'pyload-ng\n');
await page.click('#run');
await page.waitForSelector('#result:not(.hidden)', { timeout: 90000 });

check('初期状態でフォームは隠れている', !(await page.locator('#cta-form').isVisible()));

await page.click('#cta-paid-report');
await page.waitForTimeout(300);
check('CTA を押すとフォームが出る', await page.locator('#cta-form').isVisible());

const honest = await page.locator('.honest').textContent();
check('まだ存在しないことを明示する', honest.includes('does not exist yet'), honest.slice(0, 60));
check('売り込みでないことを明示する', honest.includes('No list, no marketing'));

// 不正なアドレスは弾く
await page.fill('#cta-email', 'nope');
await page.click('#cta-submit');
await page.waitForTimeout(1500);
check('不正なアドレスを拒否する', await page.locator('#cta-error').isVisible(),
  (await page.locator('#cta-error').textContent()) || '');

// 正常系
const email = `e2e-${Date.now()}@example.com`;
await page.fill('#cta-email', email);
await page.click('#cta-submit');
await page.waitForSelector('#cta-thanks:not(.hidden)', { timeout: 30000 });
check('連絡先を受け付ける', true, email);

await browser.close();
console.log(fail === 0 ? '\n関心表明: 全て通過' : `\n関心表明: ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
