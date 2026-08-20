import { renderLayout } from './layout';

const TOOL_STYLES = `
label{display:block;font-weight:600;margin:20px 0 6px}
textarea{width:100%;min-height:210px;padding:12px;border:1px solid var(--line);
border-radius:8px;background:var(--card);color:var(--fg);
font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:vertical}
select{padding:9px 12px;border:1px solid var(--line);border-radius:8px;
background:var(--card);color:var(--fg);width:100%;max-width:420px;font:inherit}
.hint{color:var(--muted);font-size:.85rem;margin-top:6px}
.summary{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0 12px}
.chip{padding:6px 14px;border-radius:999px;border:1px solid var(--line);font-weight:600;font-size:.9rem}
.chip.bad{color:var(--bad);border-color:var(--bad)}
.chip.warn{color:var(--warn);border-color:var(--warn)}
.chip.ok{color:var(--ok);border-color:var(--ok)}
.f{border:1px solid var(--line);border-left-width:4px;border-radius:8px;
padding:14px 16px;margin-bottom:10px;background:var(--card)}
.f.blocked{border-left-color:var(--bad)}
.f.review{border-left-color:var(--warn)}
.f.allowed{border-left-color:var(--ok)}
.f h3{margin:0 0 4px;font-size:1rem;font-family:ui-monospace,monospace;word-break:break-all}
.f h3 a{text-decoration:none}
.meta{color:var(--muted);font-size:.82rem;margin-bottom:8px}
.why{font-size:.92rem;margin:0}
.limits{margin-top:26px;padding:14px 16px;border:1px solid var(--line);
border-radius:8px;color:var(--muted);font-size:.85rem}
.limits ul{margin:6px 0 0;padding-left:20px}
.err{color:var(--bad);font-weight:600;margin-top:14px}
`;

const SCRIPT = `
const sid = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function track(name) {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, sessionId: sid }),
  }).catch(() => {});
}

const LABEL = { allowed: 'No obligation', review: 'Needs review', blocked: 'Obligation triggered' };

function pkgHref(eco, name) {
  return eco === 'go' ? '/pkg/go/' + name : '/pkg/' + eco + '/' + encodeURIComponent(name);
}

$('run').addEventListener('click', async () => {
  const btn = $('run');
  const content = $('content').value;
  $('error').classList.add('hidden');

  if (!content.trim()) {
    $('error').textContent = 'Paste a manifest first.';
    $('error').classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Checking...';
  track('scan_submitted');

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, distributionModel: $('model').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Check failed.');

    $('summary').innerHTML =
      '<span class="chip bad">Obligation triggered ' + data.summary.blocked + '</span>' +
      '<span class="chip warn">Needs review ' + data.summary.review + '</span>' +
      '<span class="chip ok">No obligation ' + data.summary.allowed + '</span>';

    $('findings').innerHTML = data.findings.map((f) =>
      '<div class="f ' + f.verdict + '">' +
        '<h3><a href="' + pkgHref(data.ecosystem, f.name) + '">' + esc(f.name) + '</a>' +
          (f.version ? '@' + esc(f.version) : '') + '</h3>' +
        '<p class="meta">' + LABEL[f.verdict] + ' &middot; ' +
          esc(f.spdxExpression || 'license unknown') + ' &middot; ' + esc(f.scope) + '</p>' +
        '<p class="why">' + esc(f.rationale) + '</p>' +
      '</div>'
    ).join('');

    $('limits').innerHTML = '<strong>Limits of this result</strong><ul>' +
      data.limitations.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>';

    $('result').classList.remove('hidden');
    track('scan_succeeded');
  } catch (e) {
    $('error').textContent = e.message;
    $('error').classList.remove('hidden');
    track('scan_failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check licenses';
  }
});

$('cta-paid-report').addEventListener('click', () => {
  track('cta_paid_report_clicked');
  $('cta-thanks').classList.remove('hidden');
});
`;

export function renderPage(): string {
  const body = `
<style>${TOOL_STYLES}</style>

<h1>Does anything you depend on obligate you?</h1>
<p class="sub">Paste a manifest. No signup. The answer depends on how you ship your software, so tell it that first.</p>

<label for="model">How do you ship this software?</label>
<select id="model">
  <option value="saas">Hosted SaaS &mdash; users reach it over a network</option>
  <option value="distributed-binary">Distributed binary or application</option>
  <option value="on-prem-delivery">Delivered into a customer environment</option>
  <option value="internal-only">Internal use only</option>
  <option value="library-published">Published as a library</option>
</select>
<p class="hint">The same license produces different obligations for each of these. Most scanners ignore the distinction.</p>

<label for="content">Manifest</label>
<textarea id="content" placeholder="Paste package.json, requirements.txt, or go.mod"></textarea>
<p class="hint">Pasted content is used to look up licenses and is not stored.</p>

<p style="margin-top:18px"><button class="btn" id="run">Check licenses</button></p>
<p id="error" class="err hidden"></p>

<div id="result" class="hidden">
  <div class="summary" id="summary"></div>
  <div id="findings"></div>
  <div class="limits" id="limits"></div>
  <div class="cta">
    <p>Want this as an audit-ready PDF, covering transitive dependencies too?<br>The kind of thing due diligence and procurement ask for.</p>
    <button class="btn" id="cta-paid-report">See the full report ($199)</button>
    <p id="cta-thanks" class="hint hidden">Thanks &mdash; we will let you know when it is ready.</p>
  </div>
</div>

<h2>Why the shipping model decides it</h2>
<p>AGPL-3.0 is the clearest case. Its section 13 obligation attaches when users interact with the software over a network, so a hosted SaaS triggers it while purely internal use does not. GPL works the opposite way: its obligations attach to distribution, so hosting is fine and shipping a binary is not. A scanner that reports "AGPL detected" without knowing which of these you are doing is telling you almost nothing.</p>
<p>The same applies to build-time dependencies. A tool that never ends up in your artifact cannot impose distribution obligations on it, yet most scanners warn about them anyway &mdash; which is how teams learn to ignore the warnings.</p>
<p><a href="/licenses">Browse license obligations &rarr;</a></p>
`;

  return renderLayout({
    title: 'LicenseGuard — check whether your dependencies obligate you',
    description:
      'Paste package.json, requirements.txt, or go.mod and see which dependency licenses create obligations for your specific shipping model — hosted SaaS, distributed binary, customer delivery, internal use, or published library.',
    path: '/',
    body,
    script: SCRIPT,
  });
}
