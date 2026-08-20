// Round 2: 判定の正しさを、既知の正解を持つ実パッケージで検証する。
// 「落ちないこと」ではなく「答えが合っていること」を見る。
const B = process.env.BASE || 'https://license-guard.rcc-aoki.workers.dev';
let fail = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fail++;
};

async function pkg(eco, name, model = 'saas') {
  // 名前はリテラルのまま渡す（スコープ付き npm と Go のパスを含む）
  const r = await fetch(`${B}/api/pkg/${eco}/${name}?model=${model}`);
  return r.json();
}

// 出典が明確で、ライセンスが広く知られているパッケージ。
// 期待値は各プロジェクトの公表内容に基づく。
const GROUND_TRUTH = [
  ['npm', 'express', 'MIT'],
  ['npm', 'react', 'MIT'],
  ['npm', 'vue', 'MIT'],
  ['npm', 'lodash', 'MIT'],
  ['npm', 'typescript', 'Apache-2.0'],
  ['npm', 'webpack', 'MIT'],
  ['npm', 'rxjs', 'Apache-2.0'],
  ['npm', 'core-js', 'MIT'],
  ['npm', '@angular/core', 'MIT'],
  ['npm', 'hono', 'MIT'],
  ['pypi', 'requests', 'Apache-2.0'],
  ['pypi', 'django', 'BSD-3-Clause'],
  // numpy は複数ライセンスのコードを同梱しており PEP 639 で複合式を宣言している
  ['pypi', 'numpy', 'BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0'],
  ['pypi', 'urllib3', 'MIT'],
  ['pypi', 'boto3', 'Apache-2.0'],
  ['go', 'github.com/gin-gonic/gin', 'MIT'],
  ['go', 'github.com/spf13/cobra', 'Apache-2.0'],
  ['go', 'github.com/stretchr/testify', 'MIT'],
];

console.log('--- 既知の正解との突き合わせ ---');
for (const [eco, name, want] of GROUND_TRUTH) {
  const j = await pkg(eco, name);
  check(`${eco}/${name} = ${want}`, j.license === want, `got ${j.license} (${j.licenseSource})`);
}

console.log('\n--- コピーレフトの実パッケージが正しく blocked になるか ---');
const COPYLEFT = [
  ['pypi', 'pyload-ng', 'saas', 'blocked'],
  ['pypi', 'pyload-ng', 'internal-only', 'allowed'],
  ['npm', 'nodebb', 'distributed-binary', 'blocked'],
  ['npm', 'nodebb', 'saas', 'allowed'],
  ['pypi', 'weblate', 'distributed-binary', 'blocked'],
  ['pypi', 'weblate', 'saas', 'allowed'],
];
for (const [eco, name, model, want] of COPYLEFT) {
  const j = await pkg(eco, name, model);
  check(`${name} / ${model} -> ${want}`, j.verdict === want, `${j.license} => ${j.verdict}`);
}

console.log('\n--- permissive が誤って警告されないか（偽陽性）---');
const permissiveSample = [
  'axios', 'chalk', 'commander', 'debug', 'glob', 'semver', 'rimraf', 'yargs',
  'minimatch', 'uuid', 'dotenv', 'zod', 'prettier', 'eslint', 'vite', 'esbuild',
  'postcss', 'tailwindcss', 'nanoid', 'undici',
];
let fp = [];
for (const name of permissiveSample) {
  const j = await pkg('npm', name);
  if (j.verdict !== 'allowed') fp.push(`${name}(${j.license}:${j.verdict})`);
}
check('主要npmパッケージ20件に偽陽性なし', fp.length === 0, fp.join(', '));

console.log('\n--- SPDX 式の意味論 ---');
async function explain(license, linkage = 'dynamic') {
  const r = await fetch(`${B}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'explain_license', arguments: { license, linkage } },
    }),
  });
  const j = await r.json();
  const rows = j.result?.structuredContent?.byDistributionModel ?? [];
  return Object.fromEntries(rows.map((x) => [x.model, x.verdict]));
}

const semantics = [
  // OR は利用者が選べるので緩い方
  ['(MIT OR GPL-3.0-only)', 'distributed-binary', 'allowed', 'OR は緩い方を採る'],
  // AND は両方適用されるので厳しい方
  ['(MIT AND AGPL-3.0-only)', 'saas', 'blocked', 'AND は厳しい方を採る'],
  // GPL は配布で発生、SaaS では発生しない
  ['GPL-3.0-only', 'saas', 'allowed', 'GPL は SaaS で義務なし'],
  ['GPL-3.0-only', 'distributed-binary', 'blocked', 'GPL は配布で義務あり'],
  // AGPL は SaaS でも発生
  ['AGPL-3.0-only', 'saas', 'blocked', 'AGPL は SaaS で義務あり'],
  ['AGPL-3.0-only', 'internal-only', 'allowed', 'AGPL は社内利用で義務なし'],
  // 例外つきはコピーレフトが緩和される
  ['GPL-2.0-only WITH Classpath-exception-2.0', 'distributed-binary', 'allowed', 'Classpath 例外が効く'],
  // 非商用は全滅
  ['CC-BY-NC-4.0', 'internal-only', 'blocked', 'NC は社内利用でも不可'],
  // source-available は要確認
  ['SSPL-1.0', 'saas', 'review', 'SSPL は要確認'],
  ['BUSL-1.1', 'saas', 'review', 'BUSL は要確認'],
];
for (const [expr, model, want, label] of semantics) {
  const m = await explain(expr);
  check(label, m[model] === want, `${expr} / ${model} => ${m[model]}`);
}

console.log('\n--- リンク形態の扱い ---');
const lgplDyn = await explain('LGPL-3.0-only', 'dynamic');
const lgplSta = await explain('LGPL-3.0-only', 'static');
check('LGPL は動的リンクで allowed', lgplDyn['distributed-binary'] === 'allowed');
check('LGPL は静的リンクで review', lgplSta['distributed-binary'] === 'review');

const mplDyn = await explain('MPL-2.0', 'dynamic');
const mplSta = await explain('MPL-2.0', 'static');
check('MPL はリンク形態で結論が変わらない',
  JSON.stringify(mplDyn) === JSON.stringify(mplSta),
  `dyn=${mplDyn['distributed-binary']} sta=${mplSta['distributed-binary']}`);

console.log('\n--- ライセンスページの内容が判定と一致するか ---');
for (const [id, model, want] of [
  ['AGPL-3.0-only', 'Hosted SaaS', 'Obligation triggered'],
  ['GPL-3.0-only', 'Hosted SaaS', 'No obligation'],
  ['MIT', 'Distributed binary', 'No obligation'],
]) {
  const html = await (await fetch(`${B}/license/${encodeURIComponent(id)}`)).text();
  const row = html.split('<tr>').find((r) => r.includes(model));
  check(`/license/${id} の「${model}」行が ${want}`, !!row && row.includes(want));
}

console.log('\n--- dev スコープが全ライセンスで免除されるか ---');
let devFail = [];
for (const l of ['AGPL-3.0-only', 'GPL-3.0-only', 'SSPL-1.0', 'CC-BY-NC-4.0', 'BUSL-1.1']) {
  const r = await fetch(`${B}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'explain_license', arguments: { license: l } } }),
  });
  const j = await r.json();
  const dev = j.result?.structuredContent?.devScope?.verdict;
  if (dev !== 'allowed') devFail.push(`${l}=${dev}`);
}
check('dev スコープは全て allowed', devFail.length === 0, devFail.join(','));

console.log(fail === 0 ? '\nRound 2: 全て通過' : `\nRound 2: ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
