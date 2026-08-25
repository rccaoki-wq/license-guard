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
  /** 取得元。`git+…` なら公開リリースではない */
  resolved?: string;
}

interface LockFile {
  lockfileVersion?: number;
  /** 値は外部入力なので unknown として受け、使う直前に検証する */
  packages?: Record<string, unknown>;
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
  // licenses が配列でない、license が数値、といった形も来うる
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

/**
 * `resolved` から、npm を引く意味があるかを決める。
 *
 * **git だけを見る。ホスト名では判定しない。** Artifactory や Nexus の
 * 透過プロキシを使う会社では `resolved` が npmjs 以外を指すが、中身は
 * npmjs の同じパッケージである。ホストで私設レジストリと決めつけると、
 * そういう会社のスキャンが丸ごと引けなくなる。本当に非公開なものと
 * プロキシ越しの公開パッケージを、ここで区別する手段は無い。
 */
function originOf(entry: LockEntry): Dependency['origin'] {
  return typeof entry.resolved === 'string' && entry.resolved.startsWith('git+') ? 'git' : undefined;
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
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];

  const packages = (parsed as LockFile).packages;
  if (typeof packages !== 'object' || packages === null || Array.isArray(packages)) return [];

  const out: Dependency[] = [];

  for (const [key, raw] of Object.entries(packages)) {
    // ルートプロジェクト自身
    if (key === '') continue;

    // 外部から貼り付けられる入力なので、型を信用しない。
    // null や文字列が来ても落ちてはならない（JSON.parse は通ってしまう）
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as LockEntry;

    // ワークスペースへのリンクは公開パッケージではない
    if (entry.link) continue;

    const name = nameFromLockKey(key);
    if (name === null || !isSafePackageName(name)) continue;

    out.push({
      ecosystem: 'npm',
      name,
      // version は文字列であることを確かめる。数値やオブジェクトが
      // 入っていると、以降の URL 組み立てやキャッシュキーが壊れる
      version: typeof entry.version === 'string' && entry.version !== '' ? entry.version : null,
      scope: scopeOf(entry),
      declaredLicense: declaredLicense(entry),
      ...(originOf(entry) ? { origin: originOf(entry) } : {}),
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
