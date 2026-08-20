import { parsePackageJson } from './npm';
import { isPackageLock, parsePackageLock } from './npm-lock';
import { parseRequirementsTxt } from './pypi';
import { parseGoMod } from './gomod';
import type { Dependency, Ecosystem } from '../types';

/**
 * 上流への照会が必要な依存の上限。
 *
 * 費用がかかるのは外部フェッチであって、依存の総数ではない。
 * ロックファイルはライセンスを内包しており照会が一切要らないため、
 * 数千件を含んでいてもこの上限には掛からない。
 *
 * 上限が無いと 1 リクエストで数千の外部フェッチが走り、Worker の
 * サブリクエスト上限と実行時間を使い切るうえ、無認証の公開
 * エンドポイントとして濫用される。
 */
export const MAX_LOOKUPS = 200;

export interface ParsedManifest {
  ecosystem: Ecosystem;
  dependencies: Dependency[];
}

/**
 * 貼り付けられた内容からエコシステムを判定し、依存を抽出する。
 * ファイル名が無い前提のため、内容だけで判定する。
 */
export function detectAndParse(content: string): ParsedManifest {
  const trimmed = content.trim();
  if (trimmed === '') {
    throw new Error('Input is empty.');
  }

  let result: ParsedManifest;

  if (trimmed.startsWith('{')) {
    // package-lock.json は推移的依存とライセンスの両方を持つ上位互換
    const doc: unknown = JSON.parse(trimmed);
    result = isPackageLock(doc)
      ? { ecosystem: 'npm', dependencies: parsePackageLock(trimmed) }
      : { ecosystem: 'npm', dependencies: parsePackageJson(trimmed) };
  } else if (/^module\s+\S+/m.test(trimmed) || /^require\s*\(/m.test(trimmed)) {
    result = { ecosystem: 'go', dependencies: parseGoMod(trimmed) };
  } else {
    result = { ecosystem: 'pypi', dependencies: parseRequirementsTxt(trimmed) };
  }

  if (result.dependencies.length === 0) {
    throw new Error(
      'No dependencies were found. Paste a package.json, requirements.txt, or go.mod.',
    );
  }

  // 黙って切り詰めると「全部見た」と誤解されるため、明示的に断る
  const lookups = result.dependencies.filter((d) => !d.declaredLicense).length;
  if (lookups > MAX_LOOKUPS) {
    // 既にロックファイルを送っている相手に「ロックファイルを送れ」と返さない
    const alreadyLockfile = result.dependencies.some((d) => d.declaredLicense);
    const advice = alreadyLockfile
      ? 'Most entries in this lockfile carry no license of their own, so each needs a registry lookup. Regenerating it with a current npm version records licenses inline.'
      : 'Send a package-lock.json instead — it carries licenses inline, so no lookups are needed and transitive dependencies are covered too.';
    throw new Error(
      `This manifest needs ${lookups} registry lookups, above the limit of ${MAX_LOOKUPS}. ${advice}`,
    );
  }

  return result;
}
