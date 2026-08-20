// 同時アクセス時の挙動。Worker のサブリクエスト上限と外部レジストリの
// 挙動が絡むため、単発の成功では確認にならない。
const BASE = process.env.BASE || 'https://license-guard.rcc-aoki.workers.dev';
let failures = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) failures++; };

/**
 * 本サービス自身がレート制限を掛けているため、検証を連続実行すると 429 が返る。
 * 制限そのものを試す意図ではないので、429 は待って一度だけ再試行する。
 */
async function fetchWithBackoff(url, init, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || i === tries - 1) return r;
    await new Promise((res) => setTimeout(res, 20_000));
  }
  throw new Error('unreachable');
}


const deps = {};
for (const n of ['react','vue','svelte','preact','solid-js','lit','alpinejs','htmx.org',
  'zod','yup','joi','ajv','superstruct','valibot','io-ts','runtypes',
  'dayjs','date-fns','luxon','moment']) deps[n] = '1.0.0';
const body = JSON.stringify({ content: JSON.stringify({ dependencies: deps }), distributionModel: 'saas' });

console.log('--- 10並列で20依存のスキャン ---');
const t0 = Date.now();
const results = await Promise.all(
  Array.from({ length: 10 }, () =>
    fetchWithBackoff(`${BASE}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }).then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : null })),
  ),
);
const elapsed = Date.now() - t0;

check('全リクエストが 200', results.every((r) => r.status === 200),
  results.map((r) => r.status).join(','));
check('全て20依存を返す', results.every((r) => r.body?.summary.total === 20));

const unresolvedCounts = results.map((r) => r.body?.findings.filter((f) => f.resolvedFrom === 'unresolved').length ?? -1);
check('負荷時も未解決が出ない', unresolvedCounts.every((c) => c === 0), `未解決数: ${unresolvedCounts.join(',')}`);

// 同一入力なので判定は全リクエストで一致すべき
const sigs = results.map((r) => JSON.stringify(r.body?.summary));
check('同時実行でも結果が一致する', new Set(sigs).size === 1, sigs[0]);
console.log(`     所要: ${elapsed}ms`);

console.log('\n--- MCP 20並列 ---');
const mcpResults = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    fetchWithBackoff(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: i, method: 'tools/call',
        params: { name: 'check_dependency_license',
          arguments: { ecosystem: 'npm', name: 'express', distribution_model: 'saas' } },
      }),
    }).then(async (r) => ({ status: r.status, json: await r.json() })),
  ),
);
check('MCP 全リクエストが 200', mcpResults.every((r) => r.status === 200));
check('MCP 全て同じ判定', new Set(mcpResults.map((r) => r.json.result?.structuredContent?.verdict)).size === 1,
  mcpResults[0].json.result?.structuredContent?.verdict);
check('MCP に protocol error が無い', mcpResults.every((r) => !r.json.error));

console.log(failures === 0 ? '\n負荷検証: 全て通過' : `\n負荷検証: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
