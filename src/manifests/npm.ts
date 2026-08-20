import { isSafePackageName } from './name-safety';
import type { Dependency, Scope } from '../types';

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** 範囲指定の記号を落として具体バージョンを取り出す。確定できなければ null */
function toConcreteVersion(range: string): string | null {
  const stripped = range.trim().replace(/^[\^~]|^[><=]+\s*/g, '').trim();
  return SEMVER.test(stripped) ? stripped : null;
}

const SECTIONS: Array<{ key: string; scope: Scope }> = [
  { key: 'dependencies', scope: 'runtime' },
  { key: 'devDependencies', scope: 'dev' },
  { key: 'optionalDependencies', scope: 'optional' },
];

/**
 * package.json から直接依存を抽出する。
 * peerDependencies は利用側が解決するため対象外。
 */
export function parsePackageJson(content: string): Dependency[] {
  // JSON.parse は null・数値・配列も通す。外部から貼り付けられる入力なので
  // オブジェクトであることを確かめてから触る
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];

  const doc = parsed as Record<string, unknown>;
  const out: Dependency[] = [];

  for (const { key, scope } of SECTIONS) {
    const section = doc[key];
    if (typeof section !== 'object' || section === null || Array.isArray(section)) continue;

    for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
      if (typeof range !== 'string') continue;
      // 表示偽装や空名を持ち込ませない
      if (!isSafePackageName(name)) continue;
      out.push({
        ecosystem: 'npm',
        name,
        version: toConcreteVersion(range),
        scope,
      });
    }
  }

  return out;
}
