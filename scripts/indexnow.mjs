/**
 * sitemap の URL を IndexNow へ投げる。
 *
 * 狙いは人間向けの検索順位ではなく、**AI 検索が引ける場所に存在すること**。
 * この製品が答える問い（「AGPL は SaaS で使えるのか」）は、いま検索窓より
 * チャットに投げられている。チャット側はその場でウェブを検索して答えを作るので、
 * 索引に無いものは引用されない。
 *
 * 参加エンジンは Bing・Yandex・Seznam・Naver など。1 エンジンに投げると
 * 参加各社へ共有される（仕様）。Google は参加していない。
 *
 * 使い方:  npm run indexnow
 */
import { INDEXNOW_KEY } from '../src/seo/indexnow.ts';

const ORIGIN = process.env.BASE || 'https://licenseguard.tenchorooms.com';
const HOST = new URL(ORIGIN).host;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** 仕様上の上限。超える分は分割して投げる */
const MAX_PER_POST = 10_000;

const fail = (m) => {
  console.error('FAIL ' + m);
  process.exit(1);
};

// 1. 鍵ファイルが公開されていること。これが所有証明なので、
//    先に確かめないと 403 の理由が分からなくなる
const keyRes = await fetch(`${ORIGIN}/${INDEXNOW_KEY}.txt`);
if (!keyRes.ok) fail(`鍵ファイルが公開されていない: ${keyRes.status}`);
const keyBody = (await keyRes.text()).trim();
if (keyBody !== INDEXNOW_KEY) fail(`鍵ファイルの中身が鍵と一致しない: "${keyBody.slice(0, 40)}"`);
console.log(`OK   鍵ファイルを確認 /${INDEXNOW_KEY}.txt`);

// 2. sitemap から URL を集める。手で並べると必ずずれる
const smRes = await fetch(`${ORIGIN}/sitemap.xml`);
if (!smRes.ok) fail(`sitemap を取得できない: ${smRes.status}`);
const xml = await smRes.text();
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (urls.length === 0) fail('sitemap に URL が無い');

// 別ホストの URL が混ざっていると 422 になる。混入は設定ミスなので黙って捨てない
const foreign = urls.filter((u) => new URL(u).host !== HOST);
if (foreign.length > 0) fail(`sitemap に別ホストの URL が混ざっている: ${foreign[0]}`);

console.log(`OK   sitemap から ${urls.length} 件`);

// 3. 送信
for (let i = 0; i < urls.length; i += MAX_PER_POST) {
  const batch = urls.slice(i, i + MAX_PER_POST);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, urlList: batch }),
  });

  // 200 = 受理 / 202 = 受理（検証待ち）。どちらも成功
  if (res.status !== 200 && res.status !== 202) {
    const body = await res.text().catch(() => '');

    // 鍵ファイルを公開した直後は、まだ所有確認が済んでおらず 403 になる。
    // これは設定ミスではないので、障害として扱わない。
    if (res.status === 403 && body.includes('SiteVerificationNotCompleted')) {
      console.log('\n所有確認がまだ完了していません。鍵ファイルは公開済みなので、');
      console.log('しばらく置いてから `npm run indexnow` を再実行してください。');
      process.exit(0);
    }

    fail(`送信が拒否された: ${res.status} ${body.slice(0, 200)}`);
  }
  console.log(`OK   ${batch.length} 件を送信 (HTTP ${res.status})`);
}

console.log('\nIndexNow: 送信完了');
