import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

/**
 * go.sum を解析する。
 *
 * 各モジュールは 2 行に現れる。
 *
 *   github.com/gin-gonic/gin v1.9.1 h1:...
 *   github.com/gin-gonic/gin v1.9.1/go.mod h1:...
 *
 * go.mod と違い**推移的依存まで記録される**ため、ライセンス確認の対象と
 * しては go.sum の方が適切である。問題のあるライセンスは直接追加した
 * 依存より、依存の依存として入り込むことの方が多い。
 *
 * ライセンスは持たないので、解決には ClearlyDefined 経由の照会か
 * 共有キャッシュが要る。
 */
export function parseGoSum(content: string): Dependency[] {
  const found = new Map<string, string>();

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const [modulePath, versionField] = parts as [string, string, ...string[]];

    // "v1.9.1/go.mod" は同じモジュールの別ハッシュ行なので数えない
    if (versionField.endsWith('/go.mod')) continue;
    if (!/^v\d/.test(versionField)) continue;
    if (!isSafePackageName(modulePath)) continue;
    if (!modulePath.includes('.')) continue;

    if (!found.has(modulePath)) found.set(modulePath, versionField);
  }

  return [...found].map(([name, version]) => ({
    ecosystem: 'go' as const,
    name,
    version,
    scope: 'runtime' as const,
  }));
}

export function isGoSum(content: string): boolean {
  return /^[^\s]+\s+v[^\s]+\/go\.mod\s+h1:/m.test(content);
}
