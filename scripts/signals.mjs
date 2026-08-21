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

/**
 * 巡回ボット・採点サービスの判別。
 *
 * 完全な名簿は作れない（毎日新しいものが現れる）ので、名前の癖で拾う。
 * 取りこぼしたものは「実利用」に混ざるため、判定は**厳しめに倒す**。
 * 実需要を過大評価するより過小評価するほうが、判断を誤りにくい。
 */
const PROBE_PATTERNS = [
  /probe/i, /crawler/i, /\bbot\b/i, /scanner/i, /scan\b/i, /registry/i,
  /grader/i, /grade/i, /census/i, /inspector/i, /monitor/i, /catalog/i,
  /index/i, /observatory/i, /health/i, /verify/i, /spike/i, /benchmark/i,
  /marketplace/i, /directory/i, /search/i, /glama/i, /lobehub/i, /e2e/i, /test/i,
  /beat/i, /connect/i, /\bcomp\b/i, /extractor/i, /smithery/i, /check/i,
];

const nameLooksLikeProbe = (name) => !name || PROBE_PATTERNS.some((re) => re.test(name));

/**
 * **接続しただけの相手は利用者ではない。**
 *
 * 名前で弾く方式だけでは追いつかない。初日に来たクライアント名は 33 種、
 * 翌日にはさらに増え、毎回新しい名前が現れる。名簿の保守はいずれ破綻する。
 *
 * ふるまいで見れば名前に依存しない。initialize だけしてツールを一度も
 * 呼ばずに去るのは、名前が何であれ生存確認か棚卸しであって、需要ではない。
 * 名前による判定はその補助として残す（ツールを呼んだ巡回ボットも実在しうる）。
 */
const isProbe = (s) => nameLooksLikeProbe(s.client) || s.calls === 0;

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
const sessions = q(
  "SELECT e.session_id sid, MAX(i.client_name) client, SUM(CASE WHEN e.event='tool_call' THEN 1 ELSE 0 END) calls, MIN(e.created_at) first_seen, MAX(e.created_at) last_seen FROM mcp_events e LEFT JOIN mcp_events i ON i.session_id = e.session_id AND i.event='initialize' WHERE e.synthetic = 0 AND e.session_id IS NOT NULL GROUP BY e.session_id",
);

const real = sessions.filter((s) => !isProbe(s));
const namedProbes = sessions.filter((s) => nameLooksLikeProbe(s.client));
const silent = sessions.filter((s) => !nameLooksLikeProbe(s.client) && s.calls === 0);

console.log(`セッション総数         ${sessions.length}`);
console.log(`  巡回ボット等（名前）  ${namedProbes.length}`);
console.log(`  接続のみで何もせず   ${silent.length}   ← 名前は不明だがツール未使用`);
console.log(`  実利用               ${real.length}   ← ツールを1回以上呼んだ`);

const repeat = real.filter((s) => s.calls >= 2);

console.log(`\n2回以上呼んだ（継続）   ${repeat.length}   ← Phase 0 の本命指標`);
console.log(`呼び出し総数            ${real.reduce((a, s) => a + s.calls, 0)}`);

if (real.length > 0) {
  console.log('\n実利用セッション:');
  for (const s of real.slice(0, 30)) {
    const t = new Date(s.first_seen).toISOString().replace('T', ' ').slice(0, 16);
    console.log(`  ${t}  calls=${String(s.calls).padStart(3)}  ${s.client ?? '(名前なし)'}`);
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

const web = q(
  "SELECT name, COUNT(DISTINCT session_id) sessions FROM events WHERE synthetic = 0 GROUP BY name",
);
const get = (n) => web.find((r) => r.name === n)?.sessions ?? 0;

const landed = get('landed');
const examples = get('example_loaded');
const submitted = get('scan_submitted');
const scanned = get('scan_succeeded');
const clicked = get('cta_paid_report_clicked');
const emailed = get('cta_email_submitted');

// 到達を測る前は「誰も来ていない」と「来たが何もせず帰った」を区別できず、
// 流入を作るべきか入口を直すべきか判断できなかった。段ごとの脱落を見る。
console.log(`到達                   ${landed}`);
console.log(`  例を試した           ${examples}   (${pct(examples, landed)})`);
console.log(`  自分で貼った         ${submitted}   (${pct(submitted, landed)})`);
console.log(`判定完了               ${scanned}   (${pct(scanned, landed)})`);
console.log(`CTA クリック           ${clicked}   (${pct(clicked, scanned)})`);
console.log(`連絡先を残した         ${emailed}   (${pct(emailed, scanned)})`);

if (landed > 0 && scanned === 0) {
  console.log('\n到達はあるが判定まで進んでいない。流入ではなく入口の問題。');
} else if (landed === 0) {
  console.log('\n到達が 0。入口を直しても意味がない。流入を作る段階。');
}

const [webNull] = q('SELECT COUNT(*) n FROM events WHERE synthetic IS NULL');
if (webNull.n > 0) console.log(`\n帰属不能（計測前）     ${webNull.n} 行を除外済み`);

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

if (scanned < 30 && real.length < 30) {
  console.log('判断できません。標本が足りません。');
  console.log('判定完了セッションかツール利用セッションが 30 を超えるまでは、');
  console.log('比率を読んでも偶然と区別できません。');
} else {
  const rate = scanned > 0 ? (emailed / scanned) * 100 : 0;
  console.log(`興味表明率 ${rate.toFixed(1)}%`);
  if (rate >= 5) console.log('→ Phase 1（GitHub App）に進む水準');
  else if (rate >= 1) console.log('→ 訴求文と価格を作り直して再測定');
  else console.log('→ 買い手仮説の切り替えを検討する');
}

console.log('');
