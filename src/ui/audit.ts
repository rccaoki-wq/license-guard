/**
 * 有料監査の提示。
 *
 * **無料ツールには買う口が無かった。**$199 のレポート CTA は結果画面の
 * 下にあり、スキャンを実行しなければ到達しない。2026-08-21 に本物/合成の
 * 分離を入れてからの 6 日間、到達 38 件に対してスキャン 0 件だったので、
 * 買う口に到達した実利用者は 1 人もいなかった。値段はどこにも書かれて
 * いないのと同じ状態だった。
 *
 * ここは実行を前提にしない。**着地して読むだけで、何がいくらで買えるかが
 * 分かる**ページにする。導線を製品の内側に置かない。
 *
 * 書いてある数値はすべて 2026-08-26 の実測（実在の 11 マニフェスト・
 * 依存 2,651 件を全 5 配布形態で本番 API に流したもの）。**売り文句のために
 * 丸めない。**義務を過少に言わないことがこの製品の唯一の取り柄で、
 * 値段のページでそれを破ったら製品の側も信用されない。
 */
import { renderLayout, serviceJsonLd } from './layout';

/**
 * 値段は **1 箇所**。掲示・説明文・構造化データの 3 箇所に別々の数値を
 * 書くと、片方だけ直したときに嘘が外へ出る。しかも構造化データは
 * 人間の目に触れないので、そちらが古いまま何日も配られる
 */
export const AUDIT_PRICE_USD = 1500;
export const REAUDIT_PRICE_USD = 500;
/** この金額で受ける上限。超える依頼は見積もりに回す */
export const AUDIT_DEP_LIMIT = 5000;

const usd = (n: number) => '$' + n.toLocaleString('en-US');

const AUDIT_STYLES = `
.price{display:flex;gap:14px;flex-wrap:wrap;margin:22px 0}
.tier{flex:1 1 260px;border:1px solid var(--line);border-radius:8px;padding:18px 20px;background:var(--card)}
.tier.lead{border-color:var(--ok);border-width:2px}
.tier h3{margin:0 0 2px;font-size:1rem}
.tier .amt{font-size:1.8rem;font-weight:700;line-height:1.3}
.tier .per{color:var(--muted);font-size:.85rem}
.tier ul{margin:12px 0 0;padding-left:18px;font-size:.9rem}
.tier li{margin:5px 0}
.deliv{border:1px solid var(--line);border-radius:8px;padding:4px 20px;background:var(--card);margin:18px 0}
.notfor{border-left:4px solid var(--warn);padding:2px 16px;margin:22px 0}
label{display:block;font-weight:600;margin:18px 0 6px}
input,select,textarea{width:100%;max-width:460px;padding:10px 12px;border:1px solid var(--line);
border-radius:8px;background:var(--card);color:var(--fg);font:inherit}
textarea{min-height:96px;resize:vertical;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.hint{color:var(--muted);font-size:.85rem;margin-top:6px}
.err{color:var(--bad);font-weight:600;margin-top:14px}
`;

const SCRIPT = `
const $ = (id) => document.getElementById(id);
const track = window.__lgTrack;

$('send').addEventListener('click', async () => {
  const email = $('email').value.trim();
  $('err').classList.add('hidden');
  if (!email) { $('err').textContent = 'An email address is required to reply to you.';
    $('err').classList.remove('hidden'); return; }

  $('send').disabled = true;
  track('audit_request_submitted');
  try {
    const res = await fetch('/api/audit-request', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        company: $('company').value.trim(),
        distributionModel: $('model').value,
        scope: $('scope').value.trim(),
        note: $('note').value.trim(),
      }),
    });
    const j = await res.json();
    if (!res.ok) { $('err').textContent = j.error || 'Could not send that.';
      $('err').classList.remove('hidden'); $('send').disabled = false; return; }
    $('form').classList.add('hidden');
    $('thanks').classList.remove('hidden');
  } catch {
    $('err').textContent = 'Could not reach the server.';
    $('err').classList.remove('hidden'); $('send').disabled = false;
  }
});
`;

export function renderAuditPage(): string {
  const body = `
<style>${AUDIT_STYLES}</style>

<h1>Pre-delivery licence audit</h1>
<p class="sub">Before you hand a build to a customer, find the dependencies that put an obligation
on the whole thing you deliver &mdash; not just the ones with a scary licence name.</p>

<h2>Why this is a separate problem</h2>
<p>On 26 August 2026 I ran 11 real projects &mdash; 2,651 dependencies across six ecosystems &mdash;
through every delivery model. <strong>12 dependencies change verdict</strong> between running software
yourself and shipping it. That is 0.45%, and it is the entire problem: too few to notice by reading,
too consequential to miss.</p>
<p>One of those projects is a production Rails tree with 344 dependencies. Run it yourself and nothing
obliges you to license your own code under someone else's terms. Ship the identical tree to a customer
and three dependencies do:</p>
<div class="deliv">
<ul>
<li><code>bundler-audit</code> 0.9.3 &mdash; GPL-3.0-or-later</li>
<li><code>diff-lcs</code> 1.6.2 &mdash; MIT AND Artistic-1.0-Perl AND GPL-2.0-or-later &mdash; arrives through RSpec</li>
<li><code>rdoc</code> 8.0.0 &mdash; Ruby AND GPL-2.0-only &mdash; ships inside Ruby itself</li>
</ul>
</div>
<p>Nobody chose any of them. They are three lines out of 344, they are in a great many Ruby projects,
and a person reading a dependency list does not find them.</p>

<h2>What you get</h2>
<div class="deliv">
<ul>
<li><strong>Every manifest in the repository</strong>, not one pasted file &mdash; monorepos, multiple
languages, build and runtime scopes separated.</li>
<li><strong>The obligation matrix under your actual delivery model</strong>, with the same analysis run
against the alternatives so you can see what changes if the delivery method changes.</li>
<li><strong>Per finding: the SPDX expression, where that expression came from</strong> (which registry or
upstream said so), and what it obliges you to do.</li>
<li><strong>The same-licence list</strong> &mdash; separated out, because those are the ones that reach
past the dependency and attach to your own work.</li>
<li><strong>Everything that could not be resolved, listed explicitly</strong> &mdash; git dependencies,
vendored code, internal packages. Silently dropping these is how a clean report gets produced for a
codebase that was never fully read.</li>
<li>A written report you can attach to delivery documentation or hand to a customer's review.</li>
</ul>
</div>

<h2>Price</h2>
<div class="price">
  <div class="tier lead">
    <h3>Repository audit</h3>
    <p class="amt">${usd(AUDIT_PRICE_USD)}</p>
    <p class="per">one repository, up to ${AUDIT_DEP_LIMIT.toLocaleString('en-US')} dependencies</p>
    <ul>
      <li>Written report, delivered within 5 business days</li>
      <li>All manifests and ecosystems in that repository</li>
      <li>One round of follow-up questions</li>
    </ul>
  </div>
  <div class="tier">
    <h3>Re-audit</h3>
    <p class="amt">${usd(REAUDIT_PRICE_USD)}</p>
    <p class="per">same repository, within 6 months</p>
    <ul>
      <li>What changed since the last audit</li>
      <li>New and removed obligations</li>
      <li>Useful before a release, not on a schedule</li>
    </ul>
  </div>
</div>
<p class="hint">Larger than ${AUDIT_DEP_LIMIT.toLocaleString('en-US')} dependencies, or several repositories at once: say so below and you
will get a fixed quote before any work starts. Nothing is charged until scope is agreed in writing.</p>

<h2>What this is not</h2>
<div class="notfor">
<p><strong>It is not legal advice</strong>, and it is not a substitute for counsel on a decision that
carries real money. It is an engineering analysis of what your dependency tree declares and what those
declarations oblige.</p>
<p><strong>It does not detect licensed code copied into your own source files.</strong> That is a
different class of tool (ScanCode and its relatives) and if that is your concern, this is the wrong
purchase &mdash; say so and I will tell you that rather than sell you this.</p>
<p><strong>It reads declared metadata and public registries.</strong> A package whose own metadata is
wrong will be reported as it declares itself. Where a declaration looks unreliable, that is called out
rather than smoothed over.</p>
</div>

<h2>Request an audit</h2>
<p>This goes to a person, not a list. You will get a reply with a scope and a fixed price, or a
straight answer that this is not what you need.</p>

<div id="form">
  <label for="email">Email</label>
  <input id="email" type="email" autocomplete="email" placeholder="you@company.com">

  <label for="company">Company <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
  <input id="company" type="text" autocomplete="organization">

  <label for="model">How does this software reach its users?</label>
  <select id="model">
    <option value="distributed-binary">Distributed binary or application</option>
    <option value="on-prem-delivery">Delivered into a customer environment</option>
    <option value="library-published">Published as a library</option>
    <option value="saas">Hosted SaaS</option>
    <option value="internal-only">Internal use only</option>
    <option value="">Not sure</option>
  </select>

  <label for="scope">Roughly what is in it?</label>
  <input id="scope" type="text" placeholder="e.g. one Rails monorepo, ~900 gems, plus a Go service">
  <p class="hint">An estimate is fine. Do not paste a manifest here &mdash; nothing you paste on this
  site is stored, and the request form is no exception.</p>

  <label for="note">Anything else <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
  <textarea id="note" placeholder="Deadline, the customer's review requirements, a specific dependency you are worried about"></textarea>

  <p style="margin-top:18px"><button class="btn" id="send">Send request</button></p>
  <p id="err" class="err hidden"></p>
</div>
<p id="thanks" class="hint hidden">Sent. You will get a reply at the address you gave, from a person,
with a scope and a price &mdash; or a straight answer that this is not what you need.</p>
`;

  const description =
    'A written licence audit of your repository before you ship it. Finds the dependencies whose obligations attach to the work you deliver, measured against the way you actually deliver it. ' +
    usd(AUDIT_PRICE_USD) +
    ' per repository.';

  return renderLayout({
    title: 'Pre-delivery licence audit — LicenseGuard',
    description,
    path: '/audit',
    body,
    script: SCRIPT,
    jsonLd: serviceJsonLd({
      name: 'Pre-delivery open source licence audit',
      description,
      path: '/audit',
      priceUsd: AUDIT_PRICE_USD,
    }),
  });
}
