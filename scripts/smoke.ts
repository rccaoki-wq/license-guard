// 実ネットワークに接続して resolver の実挙動を確認する。
// Run: npm run smoke
import { fetchNpmLicense } from '../src/resolver/npm';
import { fetchPypiLicense } from '../src/resolver/pypi';
import { fetchGoLicense } from '../src/resolver/clearlydefined';

const cases: Array<[string, Promise<string | null>, string]> = [
  ['npm express@4.18.2', fetchNpmLicense('express', '4.18.2'), 'MIT'],
  ['npm @types/node', fetchNpmLicense('@types/node', null), 'MIT'],
  ['pypi requests@2.31.0', fetchPypiLicense('requests', '2.31.0'), 'Apache-2.0'],
  ['pypi flask', fetchPypiLicense('flask', null), 'BSD-3-Clause'],
  ['go gin@v1.9.1', fetchGoLicense('github.com/gin-gonic/gin', 'v1.9.1'), 'MIT'],
];

let failed = 0;

for (const [label, promise, expected] of cases) {
  const actual = await promise;
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} -> ${actual} (expected ${expected})`);
}

console.log(failed === 0 ? '\nすべて期待通りです。' : `\n${failed} 件が期待と異なります。`);
process.exit(failed === 0 ? 0 : 1);
