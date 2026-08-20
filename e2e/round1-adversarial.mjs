// Round 1: 敵対的入力・境界値・プロトタイプ汚染・SPDX式の極端系
import { withSynthetic } from './synthetic.mjs';
const B = process.env.BASE || 'https://license-guard.rcc-aoki.workers.dev';
let fail = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fail++;
};

/**
 * 本サービス自身がレート制限を掛けているため、検証を連続実行すると 429 が返る。
 * 制限そのものを試す意図ではないので、429 は待って一度だけ再試行する。
 */
async function fetchWithBackoff(url, init, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, withSynthetic(init));
    if (r.status !== 429 || i === tries - 1) return r;
    await new Promise((res) => setTimeout(res, 20_000));
  }
  throw new Error('unreachable');
}


async function scan(content, model = 'saas', extra = {}) {
  const r = await fetchWithBackoff(`${B}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(extra.headers || {}) },
    body: extra.raw !== undefined ? extra.raw : JSON.stringify({ content, distributionModel: model }),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, j };
}

console.log('--- プロトタイプ汚染 ---');
for (const [label, payload] of [
  ['__proto__ キー', '{"dependencies":{"__proto__":"1.0.0"}}'],
  ['constructor キー', '{"dependencies":{"constructor":"1.0.0"}}'],
  ['prototype 経由', '{"__proto__":{"dependencies":{"evil":"1.0.0"}}}'],
  ['toString キー', '{"dependencies":{"toString":"1.0.0"}}'],
]) {
  const { status } = await scan(payload);
  const polluted = {}.polluted !== undefined || {}.evil !== undefined;
  check(`${label}: 汚染なし & 5xx でない`, !polluted && status < 500, `HTTP ${status}`);
}

console.log('\n--- 壊れた/異常なマニフェスト ---');
const NUL = String.fromCharCode(0);
const RTL = String.fromCharCode(0x202e);
const broken = [
  ['空オブジェクト', '{}'],
  ['配列', '[1,2,3]'],
  ['null', 'null'],
  ['数値', '12345'],
  ['dependencies が配列', '{"dependencies":["a","b"]}'],
  ['dependencies が文字列', '{"dependencies":"nope"}'],
  ['値が数値', '{"dependencies":{"a":1}}'],
  ['値が null', '{"dependencies":{"a":null}}'],
  ['値がオブジェクト', '{"dependencies":{"a":{"x":1}}}'],
  ['空キー', '{"dependencies":{"":"1.0.0"}}'],
  ['深いネスト', '{"dependencies":' + '{"a":'.repeat(60) + '"1.0.0"' + '}'.repeat(60) + '}'],
  ['NULバイト', JSON.stringify({ dependencies: { ['a' + NUL + 'b']: '1.0.0' } })],
  ['RTL上書き', JSON.stringify({ dependencies: { ['a' + RTL + 'b']: '1.0.0' } })],
  ['絵文字', JSON.stringify({ dependencies: { '\u{1F4E6}': '1.0.0' } })],
  ['非常に長い名前', JSON.stringify({ dependencies: { ['a'.repeat(5000)]: '1.0.0' } })],
];
for (const [label, payload] of broken) {
  const { status } = await scan(payload);
  check(`${label}: 5xx でない`, status < 500, `HTTP ${status}`);
}

console.log('\n--- HTTP の異常系 ---');
const okBody = JSON.stringify({
  content: '{"dependencies":{"a":"1.0.0"}}',
  distributionModel: 'saas',
});
const httpCases = [
  ['本文なし', { raw: '' }],
  ['JSONでない本文', { raw: 'not json at all' }],
  ['content-type なし', { raw: okBody, headers: { 'content-type': '' } }],
  ['content-type が text/plain', { raw: okBody, headers: { 'content-type': 'text/plain' } }],
  ['content が数値', { raw: JSON.stringify({ content: 123, distributionModel: 'saas' }) }],
  ['content が配列', { raw: JSON.stringify({ content: [], distributionModel: 'saas' }) }],
  [
    'model が配列',
    { raw: JSON.stringify({ content: '{"dependencies":{"a":"1.0.0"}}', distributionModel: [] }) },
  ],
  [
    '余計なキー',
    {
      raw: JSON.stringify({
        content: '{"dependencies":{"a":"1.0.0"}}',
        distributionModel: 'saas',
        admin: true,
      }),
    },
  ],
];
for (const [label, extra] of httpCases) {
  const { status } = await scan(null, 'saas', extra);
  check(`${label}: 5xx でない`, status < 500, `HTTP ${status}`);
}

console.log('\n--- 上限を超えたときのふるまい ---');
// 拒否して何も返さないより、確認できた分を返す方が有用。
// ただし不完全なスキャンが「問題なし」に見えることは許されない。
{
  const d = {};
  for (let i = 0; i < 260; i++) d['boundary-probe-' + i] = '1.0.0';
  const { status, j } = await scan(JSON.stringify({ dependencies: d }));
  check('上限超過でも 200 を返す', status === 200, `HTTP ${status}`);

  if (j && j.findings) {
    const nc = j.findings.filter((f) => f.resolvedFrom === 'not-checked');
    check('全件が結果に含まれる', j.summary.total === 260, `total=${j.summary.total}`);
    check('未確認を allowed にしない', nc.every((f) => f.verdict === 'review'), `${nc.length} 件`);
    check(
      '未確認があれば limitations に出す',
      nc.length === 0 || j.limitations.some((l) => l.includes('were not checked')),
    );
  }
}

console.log('\n--- 入力サイズ上限（4MB）---');
// package-lock.json は数百KB〜数MBになる。費用がかかるのは外部照会なので
// サイズではなく MAX_LOOKUPS で抑える
check('4MB 超は 413', (await scan('a'.repeat(4_100_000))).status === 413);
check(
  '200KB のロックファイル相当は通る',
  (await scan('{"dependencies":{"x":"1.0.0"}}\n' + '#'.repeat(200_000))).status !== 413,
);

console.log('\n--- SPDX 式の極端系 ---');
async function explain(license) {
  const r = await fetchWithBackoff(`${B}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'explain_license', arguments: { license } },
    }),
  });
  const j = await r.json();
  return {
    status: r.status,
    verdict: j.result?.structuredContent?.byDistributionModel?.[0]?.verdict,
    err: j.error,
  };
}
const spdxCases = [
  ['多重括弧', '(((MIT)))', 'allowed'],
  ['入れ子の式', '(MIT AND (Apache-2.0 OR (GPL-3.0-only AND MIT)))', null],
  ['末尾の演算子', 'MIT AND', 'review'],
  ['WITH のみ', 'MIT WITH', 'review'],
  ['空白のみ', '   ', null],
  ['非常に長い式', Array(200).fill('MIT').join(' OR '), 'allowed'],
  ['制御文字混入', 'MIT' + NUL, 'review'],
];
for (const [label, expr, want] of spdxCases) {
  const { status, verdict, err } = await explain(expr);
  const ok = status === 200 && !err;
  check(`${label}: 正常応答`, ok, `verdict=${verdict ?? 'n/a'}`);
  if (want && ok) check(`${label}: 期待どおり ${want}`, verdict === want, `got ${verdict}`);
}

console.log('\n--- MCP の異常系 ---');
const mcpBad = [
  ['id が オブジェクト', { jsonrpc: '2.0', id: {}, method: 'ping' }],
  ['method が数値', { jsonrpc: '2.0', id: 1, method: 5 }],
  ['params が配列', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: [] }],
  [
    'arguments が文字列',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'explain_license', arguments: 'x' } },
  ],
  ['巨大バッチ', Array.from({ length: 200 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }))],
];
for (const [label, body] of mcpBad) {
  const r = await fetchWithBackoff(`${B}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  check(`${label}: 5xx でない`, r.status < 500, `HTTP ${r.status}`);
}

console.log(fail === 0 ? '\nRound 1: 全て通過' : `\nRound 1: ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
