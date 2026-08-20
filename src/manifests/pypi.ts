import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

const NAME_AND_PIN = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:(==)\s*([^\s]+))?/;

/**
 * requirements.txt から依存を抽出する。
 * requirements.txt には dev/runtime の区別が存在しないため、全て runtime とする。
 */
export function parseRequirementsTxt(content: string): Dependency[] {
  const out: Dependency[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    // 環境マーカーと行末コメントを落とす
    let line = rawLine.split(';')[0] ?? '';
    line = line.split('#')[0] ?? '';
    line = line.trim();

    if (line === '') continue;
    // -r / -e / --index-url などのディレクティブ
    if (line.startsWith('-')) continue;

    const m = NAME_AND_PIN.exec(line);
    if (!m || !m[1]) continue;
    if (!isSafePackageName(m[1])) continue;

    // 名前の正規表現は ASCII しか拾わないため、不可視文字を挟まれると
    // "bad<ZWSP>pkg" が "bad" として通ってしまう。黙って別のパッケージに
    // すり替わるのは取り違えの元なので、名前の直後が正当な区切りかを確かめる。
    const next = line[m[1].length];
    if (next !== undefined && !/[[=<>!~;\s,@]/.test(next)) continue;

    out.push({
      ecosystem: 'pypi',
      name: m[1],
      version: m[2] === '==' && m[3] ? m[3] : null,
      scope: 'runtime',
    });
  }

  return out;
}
