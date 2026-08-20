import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

/**
 * yarn.lock を解析する。
 *
 * v1（classic）と v2 以降（Berry）で書式が異なるが、いずれも
 * 「見出し行にパッケージ指定、続く行に version」という構造は共通なので
 * その形だけを拾う。YAML パーサは持ち込まない（Berry は YAML だが v1 は
 * 独自形式で、両方を扱うには結局この程度の走査が要る）。
 *
 * package-lock.json と違いライセンスを内包しないため、解決には上流照会か
 * 共有キャッシュが必要になる。
 */
export function parseYarnLock(content: string): Dependency[] {
  const found = new Map<string, string>();
  let pending: string | null = null;

  for (const raw of content.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;

    // 見出し行はインデントが無く、コロンで終わる
    if (!/^\s/.test(raw) && raw.trimEnd().endsWith(':')) {
      const head = raw.trimEnd().slice(0, -1);
      // Berry のメタデータ節
      if (head.startsWith('__')) {
        pending = null;
        continue;
      }
      // "a@^1, b@~2" のように複数指定されることがある。最初の1件で足りる
      const first = head.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
      pending = nameFromSpecifier(first);
      continue;
    }

    if (pending === null) continue;

    // v1 は version "4.18.2"、Berry は version: 4.18.2
    const m = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(raw);
    if (m && m[1]) {
      if (isSafePackageName(pending) && !found.has(pending)) {
        found.set(pending, m[1]);
      }
      pending = null;
    }
  }

  return [...found].map(([name, version]) => ({
    ecosystem: 'npm' as const,
    name,
    version,
    scope: 'runtime' as const,
  }));
}

/** "express@^4.18.0" や "@types/node@npm:^22" からパッケージ名だけを取る */
function nameFromSpecifier(spec: string): string | null {
  // スコープ付きは先頭の @ を名前の一部として残す
  const at = spec.lastIndexOf('@');
  if (at <= 0) return spec === '' ? null : spec;
  return spec.slice(0, at);
}

export function isYarnLock(content: string): boolean {
  return (
    /^#\s*yarn lockfile v1/m.test(content) ||
    /^__metadata:/m.test(content) ||
    /^"?[^\s:]+@npm:/m.test(content)
  );
}
