import { isSafePackageName } from './name-safety';
import type { Dependency, Scope } from '../types';

interface LockEntry {
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  /** ワークスペース内へのシンボリックリンク。公開パッケージではない */
  link?: boolean;
}

interface LockFile {
  lockfileVersion?: number;
  packages?: Record<string, LockEntry>;
}

/** package-lock.json のキーから実際のパッケージ名を取り出す */
export function nameFromLockKey(key: string): string | null {
  // "node_modules/a/node_modules/@scope/b" のような入れ子から最後の一件を取る
  const idx = key.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const name = key.slice(idx + 'node_modules/'.length);
  return name === '' ? null : name;
}

function declaredLicense(entry: LockEntry): string | undefined {
  if (typeof entry.license === 'string' && entry.license.trim() !== '') {
    return entry.license.trim();
  }
  if (entry.license && typeof entry.license === 'object' && entry.license.type) {
    return entry.license.type;
  }
  if (Array.isArray(entry.licenses)) {
    const types = entry.licenses.map((l) => l.type).filter((t): t is string => !!t);
    if (types.length === 1) return types[0]!;
    if (types.length > 1) return `(${types.join(' OR ')})`;
  }
  return undefined;
}

function scopeOf(entry: LockEntry): Scope {
  // devOptional は「dev としてのみ必要」なので dev に寄せる
  if (entry.dev || entry.devOptional) return 'dev';
  if (entry.optional) return 'optional';
  return 'runtime';
}

/**
 * package-lock.json（v2 / v3）を解析する。
 *
 * ロックファイルは通常のマニフェストより優れた情報源である。
 *
 * - **推移的依存を含む。** AGPL のようなライセンスが問題になるのは、
 *   直接追加したときよりも依存の依存として紛れ込んだときの方が多い。
 * - **正確なバージョンを持つ。** 範囲指定から推測する必要がない。
 * - **dev フラグが実測値。** マニフェストの区分と違い、実際の解決結果。
 * - **ライセンスが埋め込まれている。** npm が解決時に記録するため、
 *   外部レジストリへの照会が不要になる。
 *
 * v1 には packages マップが無いため対象外（当時の形式には推移的な
 * ライセンス情報が無く、結局すべて照会が必要になる）。
 */
export function parsePackageLock(content: string): Dependency[] {
  const doc = JSON.parse(content) as LockFile;
  const packages = doc.packages;
  if (!packages) return [];

  const out: Dependency[] = [];

  for (const [key, entry] of Object.entries(packages)) {
    // ルートプロジェクト自身
    if (key === '') continue;
    // ワークスペースへのリンクは公開パッケージではない
    if (entry.link) continue;

    const name = nameFromLockKey(key);
    if (name === null || !isSafePackageName(name)) continue;

    out.push({
      ecosystem: 'npm',
      name,
      version: entry.version ?? null,
      scope: scopeOf(entry),
      declaredLicense: declaredLicense(entry),
    });
  }

  return out;
}

/** package-lock.json かどうかを内容から見分ける */
export function isPackageLock(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) return false;
  const d = doc as LockFile;
  return typeof d.lockfileVersion === 'number';
}
