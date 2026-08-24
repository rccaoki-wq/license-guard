/**
 * Phase 0 の判断材料を、実利用だけに絞って出す。
 *
 * これが必要な理由。初日の計測は mcp_events 981 件・events 63 セッションを
 * 記録したが、その中身は自分の E2E とレジストリの巡回ボットだった。
 * 生の COUNT(*) を見て「反応がある」と判断するのは、自分の足音を
 * 他人の足音と数え間違えることに等しい。
 *
 * 除外するもの:
 *   1. synthetic = 1        自分の検証トラフィック（E2E が印を付けている）
 *   2. 巡回ボット            名前の癖に加え、**ツールを一度も呼ばなかったセッション**
 *   3. synthetic IS NULL     計測を入れる前の行。帰属不能なので数えない
 *
 * 使い方:  npm run signals
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
// 判断は verdict.mjs に置いてテストしてある。ここは取得と表示だけ
import {
  classifySessions,
  diagnoseWeb,
  nameLooksLikeProbe,
  phaseVerdict,
} from './verdict.mjs';

// wrangler の package.json は exports に含まれるが bin/ は含まれない。
// パッケージの場所を起点に組み立てる。
// npx 経由（.cmd シム）を避けるのは、Windows のシムが argv の改行を落とすため。
const require_ = createRequire(import.meta.url);
const WRANGLER = join(dirname(require_.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const DB = 'license-guard';

/**
 * SQL は必ず 1 行で書く。
 * Windows の npm 製 CLI シム経由だと argv の改行が落ちるため、
 * 複数行の SQL は静かに壊れる。ここでは wrangler の JS を直接叩いて
 * いるので実害は無いが、壊れ方が分かりにくいので規約として揃えておく。
 */
function q(sql) {
  const out = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // wrangler は JSON の前後に飾りを出すことがあるので、配列部分だけ取り出す
  const start = out.indexOf('[');
  if (start < 0) throw new Error('unexpected wrangler output: ' + out.slice(0, 300));
  return JSON.parse(out.slice(start))[0].results;
}

const pct = (a, b) => (b === 0 ? '—' : ((a / b) * 100).toFixed(1) + '%');
const h = (s) => console.log('\n' + s + '\n' + '─'.repeat(s.length));

// ---------------------------------------------------------------- 計測の健全性

h('計測の健全性');

const [hy] = q(
  "SELECT SUM(CASE WHEN synthetic IS NULL THEN 1 ELSE 0 END) unattributable, SUM(CASE WHEN synthetic=1 THEN 1 ELSE 0 END) synthetic, SUM(CASE WHEN synthetic=0 THEN 1 ELSE 0 END) candidate, COUNT(*) total FROM mcp_events",
);

console.log(`mcp_events 総数        ${hy.total}`);
console.log(`  帰属不能（計測前）   ${hy.unattributable}   ← 実需要として数えない`);
console.log(`  自分の検証           ${hy.synthetic}`);
console.log(`  実利用の候補         ${hy.candidate}   ← ここから巡回ボットを除く`);

if (hy.candidate === 0) {
  console.log('\n候補が 0 件です。計測を入れた後のトラフィックがまだありません。');
}

// ---------------------------------------------------------------- MCP 実利用

h('MCP: 実利用（自分の検証と巡回ボットを除く）');

// セッション単位の一覧。initialize 行が client_name を持ち、
// tool_call 行は同じ session_id を持つので、ここで初めて結合できる。
// ok は「エラーにならなかった呼び出し」。explain_license は成功しても
// verdict を持たない（byDistributionModel を返す）ので、NULL を成功に数える。
const sessions = q(
  "SELECT e.session_id sid, MAX(i.client_name) client, SUM(CASE WHEN e.event='tool_call' THEN 1 ELSE 0 END) calls, SUM(CASE WHEN e.event='tool_call' AND (e.verdict IS NULL OR e.verdict <> 'error') THEN 1 ELSE 0 END) ok, MIN(e.created_at) first_seen, MAX(e.created_at) last_seen FROM mcp_events e LEFT JOIN mcp_events i ON i.session_id = e.session_id AND i.event='initialize' WHERE e.synthetic = 0 AND e.session_id IS NOT NULL GROUP BY e.session_id",
);

const { real, namedProbes, silent, errored } = classifySessions(sessions);

console.log(`セッション総数         ${sessions.length}`);
console.log(`  巡回ボット等（名前）  ${namedProbes.length}`);
console.log(`  接続のみで何もせず   ${silent.length}   ← 名前は不明だがツール未使用`);
console.log(`  壊れ方を試しただけ   ${errored.length}   ← 呼んだが成功が過半数に届かない（適合性テスト）`);
for (const e of errored) {
  console.log(`      ${e.client ?? '(名前なし)'}  ok=${e.ok}/${e.calls}`);
}
console.log(`  実利用               ${real.length}   ← 成功が過半数のセッション`);

const repeat = real.filter((s) => s.calls >= 2);

console.log(`\n2回以上呼んだ（継続）   ${repeat.length}   ← Phase 0 の本命指標`);
console.log(`成功した呼び出し総数    ${real.reduce((a, s) => a + s.ok, 0)}`);

if (real.length > 0) {
  console.log('\n実利用セッション:');
  for (const s of real.slice(0, 30)) {
    const t = new Date(s.first_seen).toISOString().replace('T', ' ').slice(0, 16);
    console.log(`  ${t}  ok=${String(s.ok).padStart(3)}/${s.calls}  ${s.client ?? '(名前なし)'}`);
  }
}

// 帰属できないツール呼び出し（セッションを送り返さないクライアント）
const [orphan] = q(
  "SELECT COUNT(*) n FROM mcp_events WHERE event='tool_call' AND synthetic = 0 AND session_id IS NULL",
);
if (orphan.n > 0) {
  console.log(
    `\n帰属できない tool_call  ${orphan.n}   ← セッションIDを送り返さないクライアント`,
  );
}

// ---------------------------------------------------------------- Web ツール

h('Web ツール: 実利用');

// 種別で分ける。到達したのが人かボットかで打ち手が正反対になる。
// unknown は人間に数えない（迷ったら過小評価に倒す）。
const web = q(
  "SELECT name, client_kind kind, COUNT(DISTINCT session_id) sessions FROM events WHERE synthetic = 0 GROUP BY name, client_kind",
);

const byKind = (n, kinds) =>
  web.filter((r) => r.name === n && kinds.includes(r.kind)).reduce((a, r) => a + r.sessions, 0);
const get = (n) => web.filter((r) => r.name === n).reduce((a, r) => a + r.sessions, 0);

const landed = get('landed');
const examples = get('example_loaded');
const submitted = get('scan_submitted');
const scanned = get('scan_succeeded');
const clicked = get('cta_paid_report_clicked');
const emailed = get('cta_email_submitted');

// 到達を測る前は「誰も来ていない」と「来たが何もせず帰った」を区別できず、
// 流入を作るべきか入口を直すべきか判断できなかった。段ごとの脱落を見る。
const humans = byKind('landed', ['browser']);
const bots = byKind('landed', ['bot']);
const unknownKind = byKind('landed', ['unknown']);
const preKind = byKind('landed', [null]);

console.log(`到達                   ${landed}`);
console.log(`  ブラウザ             ${humans}   ← 人間とみなせるのはこれだけ`);
console.log(`  ボット               ${bots}`);
console.log(`  判別できず           ${unknownKind}   ← 人間には数えない`);
if (preKind > 0) console.log(`  種別の計測前         ${preKind}`);
console.log(`  例を試した           ${examples}   (${pct(examples, landed)})`);
console.log(`  自分で貼った         ${submitted}   (${pct(submitted, landed)})`);
console.log(`判定完了               ${scanned}   (${pct(scanned, landed)})`);
console.log(`CTA クリック           ${clicked}   (${pct(clicked, scanned)})`);
console.log(`連絡先を残した         ${emailed}   (${pct(emailed, scanned)})`);

// 到達の総数ではなく、**人間とみなせる到達**で診断する。
// ボットや判別不能を数えると「入口が悪い」と誤診し、流入が要る段階で
// 入口をいじり続けることになる。分子も同じ絞り方に揃える。
const humanScanned = byKind('scan_succeeded', ['browser']);
console.log('\n' + diagnoseWeb({ humans, humanScanned, landed }).message);

const [webNull] = q('SELECT COUNT(*) n FROM events WHERE synthetic IS NULL');
if (webNull.n > 0) console.log(`\n帰属不能（計測前）     ${webNull.n} 行を除外済み`);

// ---------------------------------------------------------------- ページ到達

h('ページ到達（サーバ側計測）');

// なぜ別立てか。上の funnel はブラウザのビーコン（セッション単位）で、
// **長らくトップページにしか入っていなかった**。検索向けの 874 枚は
// 1 件も数えていなかったので、「到達 14 件」はサイト全体の数字ではなく
// トップに来た人数だった。ここはサーバ側で全ページを数える。
//
// エッジのキャッシュで数え落とさないことは実測で確かめた（同一 URL への
// 連続 5 回がすべて記録され、cf-cache-status も付かない）。ただしブラウザ側の
// max-age=3600 の分は届かない。**人数ではなくのべ回数**で、少なめに出る。
let views = [];
try {
  views = q(
    'SELECT page, client_kind kind, source, SUM(hits) hits FROM page_views WHERE synthetic = 0 GROUP BY page, client_kind, source',
  );
} catch {
  console.log('page_views テーブルがまだありません（migration 0006 未適用）。');
}

if (views.length === 0) {
  console.log('まだ記録がありません。計測を入れた時点より後の到達だけが貯まります。');
} else {
  const sum = (f) => views.filter(f).reduce((a, r) => a + r.hits, 0);
  const humanHits = sum((r) => r.kind === 'browser');

  console.log(`到達（のべ）           ${sum(() => true)}`);
  console.log(`  ブラウザ             ${humanHits}`);
  console.log(`  ボット               ${sum((r) => r.kind === 'bot')}   ← 索引されている証拠`);
  console.log(`  判別できず           ${sum((r) => r.kind === 'unknown')}`);

  // 検索から人が来ているかどうかが、874 枚を作った投資の答え合わせになる
  console.log('\n人間の参照元:');
  for (const s of ['search', 'ai', 'social', 'other', 'direct', 'internal']) {
    const n = sum((r) => r.kind === 'browser' && r.source === s);
    if (n > 0) console.log(`  ${s.padEnd(9)} ${n}`);
  }
  if (humanHits === 0) console.log('  （まだ 0）');

  const top = [...new Set(views.map((r) => r.page))]
    .map((p) => ({
      page: p,
      human: sum((r) => r.page === p && r.kind === 'browser'),
      bot: sum((r) => r.page === p && r.kind === 'bot'),
    }))
    .sort((a, b) => b.human - a.human || b.bot - a.bot)
    .slice(0, 15);

  console.log('\nページ別（上位15）:      人  ボット');
  for (const t of top) {
    console.log(`  ${t.page.padEnd(28)} ${String(t.human).padStart(3)}  ${String(t.bot).padStart(5)}`);
  }
}

// ---------------------------------------------------------------- 関心表明

h('関心表明（連絡先）');

const leads = q(
  "SELECT email, distribution_model model, note, datetime(created_at/1000,'unixepoch','+9 hours') t FROM interest_signals WHERE synthetic = 0 ORDER BY created_at DESC",
);

if (leads.length === 0) {
  console.log('まだありません。');
} else {
  for (const l of leads) console.log(`  ${l.t}  ${l.model ?? '-'}  ${l.email}${l.note ? '  「' + l.note + '」' : ''}`);
}

const [leadNull] = q('SELECT COUNT(*) n FROM interest_signals WHERE synthetic IS NULL');
if (leadNull.n > 0) console.log(`\n帰属不能（計測前）     ${leadNull.n} 件を除外済み`);

// ---------------------------------------------------------------- 判断

h('Phase 0 の判断');

for (const line of phaseVerdict({ scanned, realCount: real.length, emailed }).message) {
  console.log(line);
}

console.log('');
