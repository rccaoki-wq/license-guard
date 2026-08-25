import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

/**
 * pnpm-lock.yaml を解析する。
 *
 * packages 節のキーがそのまま「名前＋バージョン」になっている。
 * 書式は版によって二通りある。
 *
 *   v9 以降:  express@4.18.2:            '@types/node@22.5.1':
 *   v5〜v8:   /express/4.18.2:           /@types/node/22.5.1:
 *
 * peer 依存が絡むと `react-dom@18.2.0(react@18.2.0):` のように
 * 括弧が付くので、そこは切り落とす。
 *
 * YAML パーサは持ち込まない。必要なのは 1 階層のキーだけで、
 * 依存を増やす理由に乏しい。
 */
export function parsePnpmLock(content: string): Dependency[] {
  const lines = content.split(/\r?\n/);
  const found = new Map<string, { version: string | null; origin: Dependency['origin'] }>();

  let inPackages = false;
  let indent = -1;

  for (const raw of lines) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;

    if (/^packages:\s*$/.test(raw)) {
      inPackages = true;
      indent = -1;
      continue;
    }

    // インデントが戻ったら packages 節の外
    if (inPackages && !/^\s/.test(raw)) {
      inPackages = false;
      continue;
    }
    if (!inPackages) continue;

    const currentIndent = raw.length - raw.trimStart().length;
    if (indent === -1) indent = currentIndent;
    // 入れ子（resolution など）は無視し、直下のキーだけを見る
    if (currentIndent !== indent) continue;

    const line = raw.trim();
    if (!line.endsWith(':')) continue;

    const key = line.slice(0, -1).replace(/^["']|["']$/g, '');
    const parsed = splitNameVersion(key);
    if (parsed && isSafePackageName(parsed.name) && !found.has(parsed.name)) {
      found.set(parsed.name, { version: parsed.version, origin: parsed.origin });
    }
  }

  return [...found].map(([name, v]) => ({
    ecosystem: 'npm' as const,
    name,
    version: v.version,
    scope: 'runtime' as const,
    ...(v.origin ? { origin: v.origin } : {}),
  }));
}

interface KeyParts {
  name: string;
  /** バージョンとして使えないもの（tarball URL 等）は null にする */
  version: string | null;
  origin: Dependency['origin'];
}

function splitNameVersion(key: string): KeyParts | null {
  // peer 情報を落とす: react-dom@18.2.0(react@18.2.0) -> react-dom@18.2.0
  const base = key.split('(')[0]!.trim();

  // 旧形式: /name/version または /@scope/name/version
  if (base.startsWith('/')) {
    const idx = base.lastIndexOf('/');
    if (idx <= 0) return null;
    const name = base.slice(1, idx);
    const version = base.slice(idx + 1);
    return name && version ? { name, version, origin: 'registry' } : null;
  }

  // 新形式: name@version または @scope/name@version。
  // 区切りは**最初の** @（スコープの @ を除く）。git 依存の右辺は
  // tarball URL で、最後の @ で切ると名前かバージョンのどちらかが壊れる
  const from = base.startsWith('@') ? 1 : 0;
  const at = base.indexOf('@', from);
  if (at <= 0) return null;
  const name = base.slice(0, at);
  const rest = base.slice(at + 1);
  if (!name || !rest) return null;

  // git 依存は右辺が URL。**バージョンではないので version に入れない。**
  // 入れたまま照会すると版が一致せず最新版に落ち、同名の公開パッケージの
  // ライセンスを自分のものとして貼ることになる
  if (rest.includes('://')) return { name, version: null, origin: 'git' };
  if (/^(file|link|portal):/.test(rest)) return { name, version: null, origin: 'workspace' };

  return { name, version: rest, origin: 'registry' };
}

export function isPnpmLock(content: string): boolean {
  return /^lockfileVersion:/m.test(content);
}
