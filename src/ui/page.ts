export function renderPage(): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LicenseGuard — 依存ライセンスの適合チェック</title>
<meta name="description" content="package.json / requirements.txt / go.mod を貼り付けるだけで、依存OSSのライセンスがあなたの配布モデルに対して義務を発生させるかを判定します。">
<style>
:root{--bg:#fff;--fg:#16161a;--muted:#6b6b76;--line:#e4e4e8;--card:#fafafa;
--ok:#0a7c3f;--warn:#8a6100;--bad:#b3261e;--accent:#1a5fd0}
@media (prefers-color-scheme: dark){
:root{--bg:#111114;--fg:#eaeaef;--muted:#9a9aa6;--line:#2a2a31;--card:#1a1a1f;
--ok:#4ad07f;--warn:#e0b040;--bad:#ff6b5e;--accent:#6fa8ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.65 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:1.6rem;margin:0 0 8px}
.sub{color:var(--muted);margin:0 0 28px}
label{display:block;font-weight:600;margin:20px 0 6px}
textarea{width:100%;min-height:220px;padding:12px;border:1px solid var(--line);
border-radius:8px;background:var(--card);color:var(--fg);
font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:vertical}
select,button{font:inherit}
select{padding:9px 12px;border:1px solid var(--line);border-radius:8px;
background:var(--card);color:var(--fg);width:100%;max-width:420px}
button{padding:11px 22px;border:0;border-radius:8px;background:var(--accent);
color:#fff;font-weight:600;cursor:pointer}
button:disabled{opacity:.55;cursor:progress}
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
.meta{color:var(--muted);font-size:.82rem;margin-bottom:8px}
.why{font-size:.92rem;margin:0}
.limits{margin-top:28px;padding:14px 16px;border:1px solid var(--line);
border-radius:8px;color:var(--muted);font-size:.85rem}
.limits ul{margin:6px 0 0;padding-left:20px}
.cta{margin-top:28px;padding:22px;border:1px solid var(--accent);border-radius:10px;text-align:center}
.cta p{margin:0 0 14px}
.disclaimer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);
color:var(--muted);font-size:.8rem}
.err{color:var(--bad);font-weight:600;margin-top:14px}
.hidden{display:none}
</style>
</head>
<body>
<div class="wrap">
<h1>LicenseGuard</h1>
<p class="sub">依存OSSのライセンスが、あなたの配布モデルに対して義務を発生させるかを判定します。サインアップ不要。</p>

<label for="model">配布モデル</label>
<select id="model">
  <option value="saas">SaaS として外部提供する</option>
  <option value="distributed-binary">バイナリ・アプリとして配布する</option>
  <option value="on-prem-delivery">顧客環境に納品する</option>
  <option value="internal-only">社内でのみ利用する</option>
  <option value="library-published">ライブラリとして公開する</option>
</select>
<p class="hint">同じライセンスでも、配布モデルによって結論が変わります。</p>

<label for="content">マニフェストを貼り付け</label>
<textarea id="content" placeholder="package.json / requirements.txt / go.mod のいずれかをそのまま貼り付けてください"></textarea>
<p class="hint">貼り付けた内容はライセンス判定にのみ使用し、保存しません。</p>

<p style="margin-top:18px"><button id="run">判定する</button></p>
<p id="error" class="err hidden"></p>

<div id="result" class="hidden">
  <div class="summary" id="summary"></div>
  <div id="findings"></div>
  <div class="limits" id="limits"></div>
  <div class="cta">
    <p>この結果を、監査提出用のPDFレポートにまとめますか？<br>推移的依存まで含めた完全版を作成します。</p>
    <button id="cta-paid-report">有料レポートを見る（$199）</button>
    <p id="cta-thanks" class="hint hidden">ありがとうございます。準備ができ次第ご案内します。</p>
  </div>
</div>

<p class="disclaimer">
本ツールが提示するのは、公開されたライセンス条文と依存マニフェストに基づく情報であり、<strong>法的助言ではありません</strong>。
本ツールの利用によって弁護士・依頼者関係は成立しません。
判定はマニフェストに宣言されたライセンス情報に基づくものであり、全ての義務や違反を網羅するものではありません。
実際の判断にあたっては有資格の専門家にご相談ください。
</p>
</div>

<script>
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

const LABEL = { allowed: '問題なし', review: '要確認', blocked: '義務が発生' };

$('run').addEventListener('click', async () => {
  const btn = $('run');
  const content = $('content').value;
  $('error').classList.add('hidden');

  if (!content.trim()) {
    $('error').textContent = 'マニフェストを貼り付けてください。';
    $('error').classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = '判定中…';
  track('scan_submitted');

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, distributionModel: $('model').value }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || '判定に失敗しました');

    $('summary').innerHTML =
      '<span class="chip bad">義務が発生 ' + data.summary.blocked + '</span>' +
      '<span class="chip warn">要確認 ' + data.summary.review + '</span>' +
      '<span class="chip ok">問題なし ' + data.summary.allowed + '</span>';

    $('findings').innerHTML = data.findings.map((f) =>
      '<div class="f ' + f.verdict + '">' +
        '<h3>' + esc(f.name) + (f.version ? '@' + esc(f.version) : '') + '</h3>' +
        '<p class="meta">' + LABEL[f.verdict] + ' ・ ' +
          esc(f.spdxExpression || 'ライセンス不明') + ' ・ ' + esc(f.scope) + '</p>' +
        '<p class="why">' + esc(f.rationale) + '</p>' +
      '</div>'
    ).join('');

    $('limits').innerHTML = '<strong>この結果の限界</strong><ul>' +
      data.limitations.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>';

    $('result').classList.remove('hidden');
    track('scan_succeeded');
  } catch (e) {
    $('error').textContent = e.message;
    $('error').classList.remove('hidden');
    track('scan_failed');
  } finally {
    btn.disabled = false;
    btn.textContent = '判定する';
  }
});

$('cta-paid-report').addEventListener('click', () => {
  track('cta_paid_report_clicked');
  $('cta-thanks').classList.remove('hidden');
});
</script>
</body>
</html>`;
}
