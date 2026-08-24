/**
 * 本番の生存確認。**必ず合成トラフィックの印を付けて叩く。**
 *
 * これが必要な理由。同じ確認を curl で手打ちしていて、印を付け忘れた
 * 8 リクエストがそのまま到達記録に入った。ボットとして記録されたので
 * 人間の数字は汚れなかったが、あとから自分の分だけ引く手段が無く、
 * どの行が自分かを記憶から復元して手で差し引くはめになった。
 *
 * 注意力で解く問題にしない。確認したいときに一番手近にあるものが
 * 印を付ける側であれば、印の付け忘れは起きない。
 *
 * 使い方:  npm run verify:live
 */
import { SYNTHETIC_HEADER } from '../src/mcp/telemetry.ts';

const ORIGIN = process.argv[2] ?? 'https://license-guard.rcc-aoki.workers.dev';

const HEADERS = {
  // これが無いと、自分の確認が実需要の記録に混ざる
  [SYNTHETIC_HEADER]: '1',
  'user-agent': 'license-guard-verify (synthetic)',
};

/** [パス, 期待ステータス, 本文に必ず含まれるもの] */
const CHECKS = [
  ['/', 200, '/api/track'],
  ['/healthz', 200, '"ok":true'],
  ['/licenses', 200, "__lgTrack('landed')"],
  ['/compare', 200, "__lgTrack('landed')"],
  ['/license/MIT', 200, "__lgTrack('landed')"],
  ['/compare/mit-vs-apache-2.0', 200, "__lgTrack('landed')"],
  ['/license/MIT.md', 200, 'MIT'],
  ['/robots.txt', 200, 'Sitemap:'],
  ['/sitemap.xml', 200, '<urlset'],
  ['/llms.txt', 200, 'LicenseGuard'],
  ['/license/definitely-not-a-license', 404, ''],
];

let failed = 0;

for (const [path, status, needle] of CHECKS) {
  let line;
  try {
    const res = await fetch(ORIGIN + path, { headers: HEADERS });
    const body = await res.text();
    const okStatus = res.status === status;
    const okBody = needle === '' || body.includes(needle);
    if (!okStatus || !okBody) failed += 1;
    line = `${okStatus && okBody ? 'OK  ' : 'FAIL'} ${path} -> ${res.status}${
      okBody ? '' : `  （"${needle}" が本文に無い）`
    }`;
  } catch (e) {
    failed += 1;
    line = `FAIL ${path} -> ${e.message}`;
  }
  console.log(line);
}

// MCP は初期化まで確かめる。200 を返すだけでは動作の証明にならない
try {
  const res = await fetch(ORIGIN + '/mcp', {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'license-guard-verify', version: '0' } },
    }),
  });
  const body = await res.text();
  const ok = res.ok && body.includes('serverInfo');
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} /mcp initialize -> ${res.status}`);
} catch (e) {
  failed += 1;
  console.log(`FAIL /mcp initialize -> ${e.message}`);
}

console.log(failed === 0 ? '\nすべて期待通りです。' : `\n${failed} 件が期待と異なります。`);
process.exit(failed === 0 ? 0 : 1);
