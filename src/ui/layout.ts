import type { MatrixRow } from '../policy/matrix';
import type { DistributionModel, Obligation, Verdict } from '../types';

export function esc(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * 正規の出所。canonical・OG・sitemap・llms.txt がこれを基準にする。
 *
 * workers.dev から移した理由は 1 つだけ。**あのホストには DNS レコードを
 * 足せない。** workers.dev は Cloudflare 自身のゾーンなので、ホスト名そのものへの
 * TXT を要求する検証（Smithery の verified 等）を永久に通せなかった。
 */
export const SITE_ORIGIN = 'https://licenseguard.tenchorooms.com';

/**
 * 旧ホスト。**外し方に注意。**
 *
 * 公式 MCP レジストリ・Glama・Smithery・mcp.so・docker/mcp-registry・
 * awesome-mcp-servers の掲載と、既に導入した利用者の設定が、すべてこの URL を
 * 指している。`claude mcp add` した相手のマシンに入っているものは、こちらから
 * 直せない。したがって**このホストは畳まない**。
 */
export const LEGACY_ORIGIN = 'https://license-guard.rcc-aoki.workers.dev';

const STYLES = `
:root{--bg:#fff;--fg:#16161a;--muted:#6b6b76;--line:#e4e4e8;--card:#fafafa;
--ok:#0a7c3f;--warn:#8a6100;--bad:#b3261e;--accent:#1a5fd0}
@media (prefers-color-scheme: dark){
:root{--bg:#111114;--fg:#eaeaef;--muted:#9a9aa6;--line:#2a2a31;--card:#1a1a1f;
--ok:#4ad07f;--warn:#e0b040;--bad:#ff6b5e;--accent:#6fa8ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:920px;margin:0 auto;padding:24px 20px 80px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;
padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:28px;flex-wrap:wrap}
.top a.brand{font-weight:700;font-size:1.05rem;text-decoration:none;color:var(--fg)}
.top nav{display:flex;gap:16px;font-size:.9rem}
h1{font-size:1.55rem;margin:0 0 10px;line-height:1.35}
h2{font-size:1.15rem;margin:34px 0 10px}
.sub{color:var(--muted);margin:0 0 26px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
background:var(--card);padding:1px 5px;border-radius:4px;font-size:.92em}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:.92rem}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.82rem;text-transform:uppercase;letter-spacing:.03em}
.v{font-weight:700;white-space:nowrap}
.v.allowed{color:var(--ok)}
.v.review{color:var(--warn)}
.v.blocked{color:var(--bad)}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;
border:1px solid var(--line);font-size:.78rem;margin:0 5px 5px 0;color:var(--muted)}
.callout{border:1px solid var(--line);border-left:4px solid var(--accent);
border-radius:8px;padding:16px 18px;background:var(--card);margin:22px 0}
.callout p:first-child{margin-top:0}
.callout p:last-child{margin-bottom:0}
.cta{margin:32px 0;padding:22px;border:1px solid var(--accent);border-radius:10px;text-align:center}
.cta p{margin:0 0 14px}
.btn{display:inline-block;padding:11px 22px;border:0;border-radius:8px;
background:var(--accent);color:#fff;font-weight:600;text-decoration:none;cursor:pointer;font:inherit;
font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin:16px 0}
.grid a{display:block;padding:12px 14px;border:1px solid var(--line);border-radius:8px;
text-decoration:none;background:var(--card)}
.grid a strong{display:block;color:var(--fg)}
.grid a span{color:var(--muted);font-size:.82rem}
.disclaimer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);
color:var(--muted);font-size:.8rem}
.hidden{display:none}
@media (max-width:560px){table{font-size:.85rem}th,td{padding:8px 6px}}
`;

export const DISCLAIMER_HTML = `<p class="disclaimer">
LicenseGuard reports information derived from published license texts and dependency manifests.
<strong>It is not legal advice</strong> and using it does not create an attorney-client relationship.
Results reflect license metadata as declared; they do not identify every obligation or violation.
Consult qualified counsel for decisions that matter.
</p>`;

/**
 * どこに載っているかを全ページの末尾に置く。
 *
 * 2つ意味がある。ひとつは、無認証の無料ツールが本物かどうかを判断する材料に
 * 第三者カタログの掲載状況が使われること。もうひとつは、カタログ側が
 * 逆リンクを検証条件にしていること（Smithery は README・homepage・指定URLの
 * いずれかにサーバーページへのリンクがあるかを見る）。
 */
export const LISTINGS_HTML = `<p class="disclaimer">
Listed in the
<a href="https://registry.modelcontextprotocol.io/v0/servers?search=license-guard" rel="noopener">official MCP registry</a>,
on <a href="https://glama.ai/mcp/servers/rccaoki-wq/license-guard" rel="noopener">Glama</a>
and on <a href="https://smithery.ai/servers/rcc-aoki/license-guard" rel="noopener">Smithery</a>.
Source on <a href="https://github.com/rccaoki-wq/license-guard" rel="noopener">GitHub</a> (Apache-2.0).
</p>`;

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * 構造化データ（FAQPage）。
 *
 * これらのページは実際に問いへ答えているので、その形のまま機械可読にする。
 * 狙いは検索結果の見た目ではなく、**引用されるときに問いと答えの対応が
 * 曖昧にならないこと**。散文から抜き出させると、答えの範囲が勝手に伸び縮みする。
 *
 * `</script>` の閉じ込みを防ぐため `<` を必ずエスケープする。
 * パッケージ名は URL 由来＝外部入力なので、ここは省略できない。
 */
export function faqJsonLd(entries: FaqEntry[]): string {
  if (entries.length === 0) return '';

  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer },
    })),
  };

  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * 到達ビーコン。**すべてのページに入れる。**
 *
 * 以前はツールページ用の `script` に相乗りしていたので、渡していた
 * トップページ以外は何も記録していなかった。検索向けに 874 枚を用意して、
 * そこへの着地は 1 件も数えていない状態だった。到達の集計を
 * 「トップに来た人数」と読み違えていたのはこれが原因。
 *
 * ページごとに書き足す方式は同じ抜けをまた作るので、レイアウトに置く。
 * セッション ID もここで一度だけ決め、ツールページ側は
 * `window.__lgTrack` を使い回す（別々に採ると同じ訪問者が
 * 2 セッションに割れて、到達と判定完了が突き合わなくなる）。
 */
const BEACON = `
window.__lgSid=(crypto.randomUUID&&crypto.randomUUID())||String(Math.random()).slice(2);
window.__lgTrack=function(n){fetch('/api/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:n,sessionId:window.__lgSid})}).catch(function(){})};
window.__lgTrack('landed');
`.trim();

export interface LayoutOptions {
  title: string;
  description: string;
  /** サイト内の絶対パス（先頭スラッシュ付き）。canonical と OG に使う */
  path: string;
  body: string;
  /** ページ末尾に差し込むスクリプト（ツールページ用） */
  script?: string;
  /** 構造化データ。faqJsonLd() の出力をそのまま渡す */
  jsonLd?: string;
}

export function renderLayout(o: LayoutOptions): string {
  const canonical = SITE_ORIGIN + o.path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
${o.jsonLd ?? ''}
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<div class="top">
  <a class="brand" href="/">LicenseGuard</a>
  <nav>
    <a href="/">Scan</a>
    <a href="/licenses">Licenses</a>
    <a href="/compare">Compare</a>
  </nav>
</div>
${o.body}
${DISCLAIMER_HTML}
${LISTINGS_HTML}
</div>
<script>${BEACON}</script>
${o.script ? `<script>${o.script}</script>` : ''}
</body>
</html>`;
}

export const MODEL_LABEL: Record<DistributionModel, string> = {
  saas: 'Hosted SaaS',
  'distributed-binary': 'Distributed binary / app',
  'on-prem-delivery': 'Delivered to customer',
  'internal-only': 'Internal use only',
  'library-published': 'Published library',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  allowed: 'No obligation',
  review: 'Needs review',
  blocked: 'Obligation triggered',
};

const OBLIGATION_LABEL: Record<Obligation, string> = {
  attribution: 'Attribution',
  'notice-file': 'NOTICE file',
  'source-disclosure': 'Source disclosure',
  'same-license': 'Same license',
  'patent-grant': 'Patent grant',
};

export function obligationBadges(obligations: Obligation[]): string {
  if (obligations.length === 0) return '<span class="badge">None</span>';
  return obligations.map((o) => `<span class="badge">${esc(OBLIGATION_LABEL[o])}</span>`).join('');
}

/** 「同じライセンスでも使い方で結論が変わる」を1枚で示す表 */
export function verdictTable(rows: MatrixRow[]): string {
  const body = rows
    .map(
      (r) => `<tr>
<td>${esc(MODEL_LABEL[r.model])}</td>
<td class="v ${r.verdict}">${esc(VERDICT_LABEL[r.verdict])}</td>
<td>${esc(r.rationale)}</td>
</tr>`,
    )
    .join('');
  return `<table>
<thead><tr><th>How you ship it</th><th>Result</th><th>Why</th></tr></thead>
<tbody>${body}</tbody>
</table>`;
}

export function scanCta(prompt: string): string {
  return `<div class="cta">
<p>${esc(prompt)}</p>
<a class="btn" href="/">Check your whole manifest &rarr;</a>
</div>`;
}
