import { isSafePackageName } from './name-safety';
import type { Dependency, Scope } from '../types';

/** セクション名 → スコープ。target 別の依存も同じ扱いにする */
function scopeForSection(section: string): Scope | null {
  if (/(^|\.)dev-dependencies$/.test(section)) return 'dev';
  if (/(^|\.)build-dependencies$/.test(section)) return 'build';
  if (/(^|\.)dependencies$/.test(section)) return 'runtime';
  return null;
}

/**
 * Cargo.toml の依存セクションを解析する。
 *
 * 値は 2 通りある。
 *   serde = "1.0"
 *   tokio = { version = "1.40", features = ["full"] }
 *
 * `[dependencies.foo]` という個別テーブル形式にも対応する。
 * バージョンは範囲指定なので確定版としては扱わない（Cargo の "1.0" は
 * ^1.0 を意味する）。確定版が要る場合は Cargo.lock を使う。
 */
export function parseCargoToml(content: string): Dependency[] {
  const found = new Map<string, Scope>();
  let scope: Scope | null = null;
  let tableName: string | null = null;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const section = header[1]!.trim();
      tableName = null;

      // [dependencies.serde] のような個別テーブル
      const perDep = /^(.*\bdependencies)\.([^.]+)$/.exec(section);
      if (perDep) {
        scope = scopeForSection(perDep[1]!);
        tableName = perDep[2]!.replace(/^["']|["']$/g, '');
      } else {
        scope = scopeForSection(section);
      }

      if (scope && tableName && isSafePackageName(tableName) && !found.has(tableName)) {
        found.set(tableName, scope);
      }
      continue;
    }

    if (!scope || tableName) continue;

    const m = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (!m || !m[1]) continue;
    if (!isSafePackageName(m[1]) || found.has(m[1])) continue;
    found.set(m[1], scope);
  }

  return [...found].map(([name, s]) => ({
    ecosystem: 'cargo' as const,
    name,
    // Cargo のバージョン表記は範囲。確定版は Cargo.lock 側にある
    version: null,
    scope: s,
  }));
}

export function isCargoToml(content: string): boolean {
  return (
    /^\[(dependencies|dev-dependencies|build-dependencies)\]/m.test(content) ||
    (/^\[package\]/m.test(content) && /^\s*edition\s*=/m.test(content))
  );
}
