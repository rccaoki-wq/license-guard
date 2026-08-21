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

// --- リソースとプロンプト ---
// ホスト版と同じ中身が、公式 SDK クライアント経由でも取れることを見る。
// ユニットテストは関数を直接比べているだけで、実プロセスを通していない。

const caps = client.getServerCapabilities();
check('resources と prompts を宣言している', !!caps?.resources && !!caps?.prompts);

const { resources } = await client.listResources();
check('リソースを列挙する', resources.length >= 20, `${resources.length} 件`);

const agplUri = 'licenseguard://license/AGPL-3.0-only';
const read = await client.readResource({ uri: agplUri });
const body = read.contents?.[0]?.text ?? '';
check('リソースが判定表を含む', body.includes('blocked') && body.includes('allowed'));
check('リソースが dev スコープの免除に触れる', body.includes('build-time-only'));
check('リソースが法的助言でないと明示する', body.includes('Not legal advice'));

// リソースの判定が、同じ問いに対するツールの答えと一致すること。
// ここが割れると「読んだ答え」と「呼んだ答え」が食い違う
const agplSaas = await client.callTool({
  name: 'check_dependency_license',
  arguments: { ecosystem: 'pypi', name: 'pyload-ng', distribution_model: 'saas' },
});
check(
  'リソースとツールの判定が一致する',
  body.includes('| blocked |') && agplSaas.structuredContent?.verdict === 'blocked',
);

const { prompts } = await client.listPrompts();
check('プロンプトを列挙する', prompts.length === 2, prompts.map((p) => p.name).join(','));

const audit = await client.getPrompt({
  name: 'audit_project',
  arguments: { distribution_model: 'saas' },
});
const auditText = audit.messages?.[0]?.content?.text ?? '';
check('audit_project がロックファイルを優先させる', auditText.includes('package-lock.json'));
check('audit_project が未確認を安全と報告させない', auditText.includes('not-checked'));

let unknownPromptRejected = false;
try {
  await client.getPrompt({ name: 'no-such-prompt', arguments: {} });
} catch {
  unknownPromptRejected = true;
}
check('未知のプロンプトを拒否する', unknownPromptRejected);

await client.close();
console.log(fail === 0 ? '\nローカル stdio: 全て通過' : `\nローカル stdio: ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
