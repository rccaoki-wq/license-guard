// アクセシビリティ。公開する Web ツールとして最低限の水準を満たすか。
import { chromium } from 'playwright';
import { markSyntheticFor } from './synthetic.mjs';

const BASE = process.env.BASE || 'https://license-guard.rcc-aoki.workers.dev';
let fail = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch();
const page = await browser.newPage();
// 自分のオリジン宛だけに印を付ける（全リクエストに付けると第三者リソースを壊す）
await markSyntheticFor(page, BASE);

for (const path of ['/', '/licenses', '/license/MIT', '/pkg/npm/express']) {
  console.log(`\n--- ${path} ---`);
  await page.goto(BASE + path, { waitUntil: 'networkidle' });

  check('lang 属性がある', (await page.locator('html').getAttribute('lang')) === 'en');
  check('title がある', (await page.title()).length > 10);

  const h1 = await page.locator('h1').count();
  check('h1 がちょうど1つ', h1 === 1, `${h1} 個`);

  // 見出しの階層が飛んでいないか
  const levels = await page.$$eval('h1,h2,h3,h4', (els) =>
    els.map((e) => Number(e.tagName[1])),
  );
  let skipped = null;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) skipped = `h${levels[i - 1]} -> h${levels[i]}`;
  }
  check('見出しの階層が飛んでいない', skipped === null, skipped || '');

  // 画像に代替テキスト
  const imgsNoAlt = await page.$$eval('img', (els) =>
    els.filter((e) => !e.hasAttribute('alt')).length,
  );
  check('alt の無い画像が無い', imgsNoAlt === 0, `${imgsNoAlt} 個`);

  // リンクに文字が入っているか
  const emptyLinks = await page.$$eval('a', (els) =>
    els.filter((e) => !e.textContent.trim() && !e.getAttribute('aria-label')).length,
  );
  check('テキストの無いリンクが無い', emptyLinks === 0, `${emptyLinks} 個`);

  // 表にヘッダがあるか
  const tablesNoTh = await page.$$eval('table', (els) =>
    els.filter((t) => t.querySelectorAll('th').length === 0).length,
  );
  check('ヘッダの無い表が無い', tablesNoTh === 0, `${tablesNoTh} 個`);
}

console.log('\n--- フォーム（トップページ）---');
await page.goto(BASE, { waitUntil: 'networkidle' });

for (const id of ['model', 'content']) {
  const labelled = await page.$eval(
    `label[for="${id}"]`,
    (el) => !!el.textContent.trim(),
  ).catch(() => false);
  check(`#${id} に対応する label がある`, labelled);
}

const btnText = await page.locator('#run').textContent();
check('ボタンに文字がある', !!btnText.trim(), btnText);

console.log('\n--- キーボード操作 ---');
await page.keyboard.press('Tab');
const firstFocus = await page.evaluate(() => document.activeElement?.tagName);
check('Tab でフォーカスが移る', !!firstFocus && firstFocus !== 'BODY', firstFocus);

// フォーム要素までキーボードだけで到達し、操作できるか
await page.focus('#content');
await page.keyboard.type('express\n');
await page.focus('#run');
await page.keyboard.press('Enter');
await page.waitForSelector('#result:not(.hidden)', { timeout: 60000 });
check('キーボードだけで判定を実行できる', true);

const focusVisible = await page.evaluate(() => {
  const el = document.getElementById('run');
  el.focus();
  const s = getComputedStyle(el);
  // 既定のフォーカスリングを打ち消していないこと
  return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
});
check('フォーカス位置が視認できる', focusVisible);

console.log('\n--- 色以外の手がかり ---');
// 判定を色だけで伝えていないか（色覚特性への配慮）
const firstFinding = await page.locator('.f').first().textContent();
const hasTextVerdict = /No obligation|Needs review|Obligation triggered/.test(firstFinding);
check('判定が文字でも示される（色のみに依存しない）', hasTextVerdict);

console.log('\n--- 縮小表示 ---');
await page.setViewportSize({ width: 320, height: 700 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check('320px 幅で横スクロールしない', !overflow);

await page.evaluate(() => (document.body.style.zoom = '2'));
await page.waitForTimeout(300);
const zoomOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check('200% 拡大で横スクロールしない', !zoomOverflow);

await browser.close();
console.log(fail === 0 ? '\nアクセシビリティ: 全て通過' : `\nアクセシビリティ: ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
