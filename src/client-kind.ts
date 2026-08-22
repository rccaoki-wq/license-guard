/**
 * User-Agent を粗く分類する。
 *
 * **生の UA は保存しない。** ここで返す 3 値だけを記録する。
 * IP もパッケージ名もマニフェスト本文も保存しない方針の延長で、
 * 「人かボットか」以上の解像度を持たせない。UA 文字列は端末構成を
 * かなり細かく含むので、そのまま置くと約束を破ることになる。
 *
 * 判定は当てにいかない。**迷ったら unknown に落とす。**
 * ボットを人間に数えると需要を過大評価する。それが一番避けたい誤りなので、
 * 疑わしいものは bot 側でなく unknown に置き、集計では人間に数えない。
 */
export type ClientKind = 'bot' | 'browser' | 'unknown';

/**
 * 自己申告するボット。
 *
 * AI 検索のクローラーは概ね名乗る。名乗らないものは捕まえられないが、
 * それは unknown に落ちるので人間には数えられない。
 */
const BOT_PATTERNS = [
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /slurp/i,
  /headless/i,
  /phantom/i,
  /puppeteer/i,
  /playwright/i,
  /scrap/i,
  /fetch(er)?\b/i,
  /monitor/i,
  /preview/i,
  /validator/i,
  /lighthouse/i,
  /pagespeed/i,
  /curl\//i,
  /wget/i,
  /python-requests/i,
  /go-http-client/i,
  /axios\//i,
  /node-fetch/i,
  /okhttp/i,
  /java\//i,
];

/** 実ブラウザが名乗る組み合わせ。ボット判定を先に通してから見る */
const BROWSER_PATTERNS = [/\bChrome\/\d/i, /\bFirefox\/\d/i, /\bSafari\/\d/i, /\bEdg\/\d/i];

export function classifyClient(userAgent: string | null | undefined): ClientKind {
  if (typeof userAgent !== 'string') return 'unknown';

  const ua = userAgent.trim();
  if (ua === '' || ua.length > 512) return 'unknown';

  // ボット判定を先に。多くのボットは Mozilla/5.0 を名乗ったうえで
  // 自分の名前を足すので、ブラウザ判定を先にすると全部ブラウザになる
  if (BOT_PATTERNS.some((re) => re.test(ua))) return 'bot';
  if (BROWSER_PATTERNS.some((re) => re.test(ua))) return 'browser';

  return 'unknown';
}
