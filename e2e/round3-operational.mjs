// Round 3: 運用面。キャッシュ挙動、HTTPセマンティクス、状態の整合性、
// 上流障害時の劣化、経路をまたいだ答えの一致を見る。
const B = process.env.BASE || 'https://license-guard.rcc-aoki.workers.dev';
let fail = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fail++;
};

const j = async (path, init) => {
  const r = await fetch(B + path, init);
  return { r, body: await r.json().catch(() => null) };
};

console.log('--- 同じ問いに経路をまたいで同じ答えを返すか ---');
// 判定が経路ごとにズレると、どれを信じてよいか分からなくなる
for (const [eco, name, model] of [
  ['npm', 'express', 'saas'],
  ['pypi', 'pyload-ng', 'saas'],
  ['go', 'github.com/gin-gonic/gin', 'distributed-binary'],
]) {
  const api = (await j(`/api/pkg/${eco}/${name}?model=${model}`)).body;

  const mcpRes = await fetch(`${B}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'check_dependency_license',
        arguments: { ecosystem: eco, name, distribution_model: model } },
    }),
  });
  const mcp = (await mcpRes.json()).result?.structuredContent;

  check(`${eco}/${name}: API と MCP が一致`,
    api.license === mcp.license && api.verdict === mcp.verdict,
    `API=${api.license}/${api.verdict} MCP=${mcp.license}/${mcp.verdict}`);

  const html = await (await fetch(`${B}/pkg/${eco}/${name}`)).text();
  const shownLicense = api.license && html.includes(api.license);
  check(`${eco}/${name}: HTMLページも同じライセンスを示す`, !!shownLicense);
}

console.log('\n--- キャッシュの一貫性 ---');
// 初回と2回目で答えが変わってはいけない
const target = '/api/pkg/npm/is-promise?model=saas';
const first = (await j(target)).body;
const second = (await j(target)).body;
check('連続呼び出しで license が一致', first.license === second.license,
  `${first.license} / ${second.license}`);
check('連続呼び出しで verdict が一致', first.verdict === second.verdict);
check('licenseSource が unresolved でない', first.licenseSource !== 'unresolved', first.licenseSource);

console.log('\n--- 冪等性: 同じ入力は同じ出力 ---');
const scanBody = JSON.stringify({
  content: JSON.stringify({ dependencies: { express: '4.18.2', chalk: '5.0.0' } }),
  distributionModel: 'saas',
});
const runs = await Promise.all(
  Array.from({ length: 3 }, () =>
    j('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: scanBody })),
);
const shapes = runs.map((x) => JSON.stringify(x.body.findings.map((f) => [f.name, f.verdict, f.spdxExpression])));
check('3回とも同一の結果', new Set(shapes).size === 1);

console.log('\n--- HTTP セマンティクス ---');
const home = await fetch(`${B}/`);
check('/ は text/html', (home.headers.get('content-type') || '').includes('text/html'));
check('/ に cache-control がある', !!home.headers.get('cache-control'));

const sm = await fetch(`${B}/sitemap.xml`);
check('sitemap は xml', (sm.headers.get('content-type') || '').includes('xml'));

const lic = await fetch(`${B}/license/MIT`);
check('ライセンスページは長めにキャッシュされる',
  (lic.headers.get('cache-control') || '').includes('s-maxage'));

const apiRes = await fetch(`${B}/api/pkg/npm/express?model=saas`);
check('/api/pkg は application/json', (apiRes.headers.get('content-type') || '').includes('json'));

const unresolved = await fetch(`${B}/api/pkg/npm/this-package-surely-does-not-exist-xyz-9910`);
const uc = unresolved.headers.get('cache-control') || '';
check('未解決の結果は短命キャッシュ', uc.includes('max-age=300'), uc);

console.log('\n--- 存在しない経路 ---');
for (const [p, want] of [
  ['/nope', 404],
  ['/license/', 404],
  ['/api/', 404],
  // 名前が空なのは「見つからない」ではなく「不正な要求」なので 400 が正しい
  ['/api/pkg/npm/', 400],
  ['/pkg/', 404],
]) {
  const r = await fetch(B + p);
  check(`${p} -> ${want}`, r.status === want, `HTTP ${r.status}`);
}

console.log('\n--- HEAD / OPTIONS ---');
const head = await fetch(`${B}/`, { method: 'HEAD' });
check('HEAD / が 5xx にならない', head.status < 500, `HTTP ${head.status}`);
const opts = await fetch(`${B}/api/scan`, { method: 'OPTIONS' });
check('OPTIONS が 5xx にならない', opts.status < 500, `HTTP ${opts.status}`);
const putScan = await fetch(`${B}/api/scan`, { method: 'PUT' });
check('PUT /api/scan が 5xx にならない', putScan.status < 500, `HTTP ${putScan.status}`);

console.log('\n--- sitemap と実ページの整合 ---');
const smXml = await (await fetch(`${B}/sitemap.xml`)).text();
const locs = [...smXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('sitemap に URL がある', locs.length > 20, `${locs.length} 件`);
check('全 URL が自サイト', locs.every((u) => u.startsWith(B)), '');
const sample = locs.filter((u) => u.includes('/pkg/')).slice(0, 5);
let bad = [];
for (const u of sample) {
  const r = await fetch(u);
  if (r.status !== 200) bad.push(`${u}=${r.status}`);
}
check('sitemap のパッケージページが 200', bad.length === 0, bad.join(','));

console.log('\n--- llms.txt の記述が実際に動くか ---');
const llms = await (await fetch(`${B}/llms.txt`)).text();
const apiExample = llms.match(/\((https:\/\/[^)]*\/api\/pkg\/[^)]+)\)/)?.[1];
check('llms.txt に API の実例がある', !!apiExample, apiExample || '');
if (apiExample) {
  const r = await fetch(apiExample);
  check('その実例が実際に 200 を返す', r.status === 200, `HTTP ${r.status}`);
}
const mcpUrl = llms.match(/\((https:\/\/[^)]*\/mcp)\)/)?.[1];
if (mcpUrl) {
  const r = await fetch(mcpUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  check('llms.txt の MCP URL が実際に動く', r.status === 200);
}

console.log('\n--- 免責が全経路に載っているか ---');
const disclaimerChecks = [
  ['/api/pkg/npm/express?model=saas', (b) => !!b.disclaimer],
  ['/', null],
  ['/licenses', null],
  ['/license/MIT', null],
  ['/pkg/npm/express', null],
  ['/llms.txt', null],
];
for (const [path, jsonCheck] of disclaimerChecks) {
  if (jsonCheck) {
    const { body } = await j(path);
    check(`${path} に免責`, jsonCheck(body));
  } else {
    const t = await (await fetch(B + path)).text();
    check(`${path} に免責`, t.includes('not legal advice'));
  }
}

console.log(fail === 0 ? '\nRound 3: 全て通過' : `\nRound 3: ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
