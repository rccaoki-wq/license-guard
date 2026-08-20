// 公式 SDK のクライアントで実際にハンドシェイクする。
// これまで curl で JSON-RPC を手打ちしただけで、実クライアントは未検証だった。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SYNTHETIC_HEADERS } from './synthetic.mjs';

const URL_ = process.env.MCP_URL || 'https://license-guard.rcc-aoki.workers.dev/mcp';
let failures = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) failures++; };

const client = new Client({ name: 'licenseguard-e2e', version: '1.0.0' }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(URL_), {
  requestInit: { headers: SYNTHETIC_HEADERS },
});

await client.connect(transport);
check('公式SDKクライアントで接続できる', true);

const caps = client.getServerCapabilities();
check('tools capability を宣言している', !!caps?.tools);

const info = client.getServerVersion();
check('serverInfo を返す', info?.name === 'licenseguard', JSON.stringify(info));

const { tools } = await client.listTools();
check('ツールを3件列挙する', tools.length === 3, tools.map((t) => t.name).join(','));
check('全ツールに inputSchema がある', tools.every((t) => t.inputSchema?.type === 'object'));

// 実データでツールを呼ぶ
const agpl = await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'pypi', name: 'pyload-ng', distribution_model: 'saas' },
});
check('AGPL/SaaS が blocked', agpl.structuredContent?.verdict === 'blocked', agpl.structuredContent?.license);
check('本文に条項の引用がある', agpl.content[0].text.includes('section 13'));

const internal = await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'pypi', name: 'pyload-ng', distribution_model: 'internal-only' },
});
check('同じ依存が internal-only で allowed', internal.structuredContent?.verdict === 'allowed');

const dev = await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'pypi', name: 'pyload-ng', distribution_model: 'saas', scope: 'dev' },
});
check('dev スコープは警告しない', dev.structuredContent?.verdict === 'allowed');

const explain = await client.callTool({
  name: 'explain_license',
  arguments: { license: 'MPL-2.0', linkage: 'static' },
});
check('MPL 静的リンクが allowed', explain.structuredContent?.byDistributionModel?.[0]?.verdict === 'allowed');

// エラー系: 未知ツールはプロトコルエラーになるべき
let protocolError = false;
try { await client.callTool({ name: 'no_such_tool', arguments: {} }); }
catch { protocolError = true; }
check('未知ツールはプロトコルエラー', protocolError);

// 不正引数は isError で返る（プロトコルエラーにしない）
const bad = await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'maven', name: 'x', distribution_model: 'saas' },
});
check('不正引数は isError で返る', bad.isError === true);

await client.close();
console.log(failures === 0 ? '\nMCPクライアント検証: 全て通過' : `\nMCPクライアント検証: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
