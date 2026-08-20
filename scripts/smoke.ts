// 実ネットワークに接続して resolver の実挙動を確認する。
// Run: npm run smoke
import { fetchNpmLicense } from '../src/resolver/npm';
import { fetchPypiLicense } from '../src/resolver/pypi';
import { fetchGoLicense } from '../src/resolver/clearlydefined';
import { fetchCratesLicense } from '../src/resolver/crates';

const cases: Array<[string, Promise<{ spdx: string | null }>, string]> = [
  ['npm express@4.18.2', fetchNpmLicense('express', '4.18.2'), 'MIT'],
  ['npm @types/node', fetchNpmLicense('@types/node', null), 'MIT'],
  ['npm typescript@5.6.0 (unpublished pin)', fetchNpmLicense('typescript', '5.6.0'), 'Apache-2.0'],
  ['npm typescript@5.6.2 (real pin)', fetchNpmLicense('typescript', '5.6.2'), 'Apache-2.0'],
  ['pypi requests@2.31.0', fetchPypiLicense('requests', '2.31.0'), 'Apache-2.0'],
  ['pypi flask', fetchPypiLicense('flask', null), 'BSD-3-Clause'],
  ['go gin@v1.9.1', fetchGoLicense('github.com/gin-gonic/gin', 'v1.9.1'), 'MIT'],
  ['go gin (no version)', fetchGoLicense('github.com/gin-gonic/gin', null), 'MIT'],
  ['go cobra (no version)', fetchGoLicense('github.com/spf13/cobra', null), 'Apache-2.0'],
  ['cargo serde@1.0.210', fetchCratesLicense('serde', '1.0.210'), 'MIT OR Apache-2.0'],
  ['cargo tokio (no version)', fetchCratesLicense('tokio', null), 'MIT'],
];

let failed = 0;

for (const [label, promise, expected] of cases) {
  const actual = (await promise).spdx;
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} -> ${actual} (expected ${expected})`);
}

console.log(failed === 0 ? '\nすべて期待通りです。' : `\n${failed} 件が期待と異なります。`);
process.exit(failed === 0 ? 0 : 1);
