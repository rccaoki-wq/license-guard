// ローカル stdio サーバーを実プロセスとして起動し、公式 SDK クライアントで接続する。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let fail = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++; };

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/local/stdio.ts'],
});
const client = new Client({ name: 'stdio-e2e', version: '1.0.0' }, { capabilities: {} });

await client.connect(transport);
check('stdio で接続できる', true);

const info = client.getServerVersion();
check('serverInfo を返す', info?.name === 'licenseguard', JSON.stringify(info));

const { tools } = await client.listTools();
check('ツール3件', tools.length === 3, tools.map((t) => t.name).join(','));

// 実データ: AGPL が SaaS で blocked
const agpl = await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'pypi', name: 'pyload-ng', distribution_model: 'saas' },
});
check('AGPL/SaaS が blocked', agpl.structuredContent?.verdict === 'blocked', agpl.structuredContent?.license);

const internal = await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'pypi', name: 'pyload-ng', distribution_model: 'internal-only' },
});
check('同じ依存が internal-only で allowed', internal.structuredContent?.verdict === 'allowed');

// ロックファイル（外部にマニフェストを送らない経路）
const lock = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    'node_modules/a': { version: '1.0.0', license: 'MIT' },
    'node_modules/b': { version: '2.0.0', license: 'AGPL-3.0-only' },
  },
});
const manifest = await client.callTool({
  name: 'check_manifest_licenses',
  arguments: { content: lock, distribution_model: 'saas' },
});
check('ロックファイルを判定できる', manifest.structuredContent?.summary?.total === 2,
  JSON.stringify(manifest.structuredContent?.summary));
check('埋め込みライセンスで照会不要', manifest.structuredContent?.findings?.every((f) => f.resolvedFrom === 'lockfile'));

// 2回目はキャッシュが効く
const t0 = Date.now();
await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'pypi', name: 'pyload-ng', distribution_model: 'saas' },
});
check('2回目はキャッシュで速い', Date.now() - t0 < 1500, `${Date.now() - t0}ms`);

const explain = await client.callTool({
  name: 'explain_license',
  arguments: { license: 'MPL-2.0', linkage: 'static' },
});
check('MPL 静的リンクが allowed', explain.structuredContent?.byDistributionModel?.[0]?.verdict === 'allowed');

await client.close();
console.log(fail === 0 ? '\nローカル stdio: 全て通過' : `\nローカル stdio: ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
