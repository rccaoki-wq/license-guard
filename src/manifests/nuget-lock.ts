import type { Dependency } from '../types';

/**
 * `packages.lock.json`（NuGet のロックファイル）。
 *
 * 形は package-lock.json と紛らわしい——どちらも `{` で始まり、
 * `dependencies` という鍵を持つ。だが中身の階層が違う。NuGet 側は
 * **ターゲットフレームワークで一段挟む**：
 *
 * ```json
 * { "version": 1,
 *   "dependencies": {
 *     "net8.0": {
 *       "Newtonsoft.Json": { "type": "Direct", "requested": "[13.0.3, )", "resolved": "13.0.3" },
 *       "Serilog":         { "type": "Transitive", "resolved": "4.2.0" } } } }
 * ```
 *
 * 見分けは `lockfileVersion` の有無で足りている（npm 側はそれを要求し、
 * NuGet 側は持たない）が、それだけに頼らない。**深さ 2 の要素が
 * `type` を持つこと**を確かめる。npm の v1 形式は同じ深さに `version` と
 * URL の `resolved` を置くので、`type` の有無で確実に切れる。
 */

/** NuGet が `type` に書く値。ここに無い値なら別形式を疑う */
const ENTRY_TYPES = new Set(['Direct', 'Transitive', 'Project', 'CentralTransitive']);

interface LockEntry {
  type?: unknown;
  resolved?: unknown;
}

interface PackagesLock {
  dependencies?: Record<string, Record<string, LockEntry>>;
}

function isEntry(v: unknown): v is LockEntry {
  return typeof v === 'object' && v !== null;
}

export function isNugetPackagesLock(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) return false;
  const deps = (doc as PackagesLock).dependencies;
  if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) return false;

  for (const byFramework of Object.values(deps)) {
    if (typeof byFramework !== 'object' || byFramework === null || Array.isArray(byFramework)) {
      continue;
    }
    for (const entry of Object.values(byFramework)) {
      // `type` がこの語彙に入っていれば NuGet。npm の v1 は同じ深さに
      // `version` と URL の `resolved` を置くだけで `type` を持たない
      if (isEntry(entry) && typeof entry.type === 'string' && ENTRY_TYPES.has(entry.type)) {
        return true;
      }
    }
  }
  return false;
}

export function parseNugetPackagesLock(content: string): Dependency[] {
  const doc = JSON.parse(content) as PackagesLock;
  const byFramework = doc.dependencies ?? {};

  // 同じパッケージが net8.0 と net472 の両方に載る。**版まで同じなら
  // 同じ座標なのでまとめる**が、フレームワークごとに違う版に解決されて
  // いる場合は別物なので両方残す。片方だけ見て答えると、もう片方の
  // フレームワークで実際に入る版の話をしていないことになる
  const seen = new Set<string>();
  const out: Dependency[] = [];

  for (const entries of Object.values(byFramework)) {
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) continue;

    for (const [name, entry] of Object.entries(entries)) {
      if (!isEntry(entry)) continue;
      if (name === '') continue;

      // Project は同じソリューション内の別プロジェクトへの参照。
      // nuget.org には存在しないので、照会すれば必ず空振りする
      const isProject = entry.type === 'Project';
      const version =
        typeof entry.resolved === 'string' && entry.resolved !== '' ? entry.resolved : null;

      const key = `${name}@${version ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        ecosystem: 'nuget',
        name,
        version,
        // packages.lock.json は開発専用かどうかを記録しない。
        // `PrivateAssets` は .csproj 側にあり、ここまで降りてこない。
        // 分からないので全部 runtime に倒す——**消えるより鳴るほうがいい**
        scope: 'runtime',
        origin: isProject ? 'workspace' : 'registry',
      });
    }
  }

  return out;
}
