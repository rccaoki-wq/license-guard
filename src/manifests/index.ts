import { parsePackageJson } from './npm';
import { parseRequirementsTxt } from './pypi';
import { parseGoMod } from './gomod';
import type { Dependency, Ecosystem } from '../types';

/**
 * 1リクエストで解決する直接依存の上限。
 *
 * 100KB のマニフェストには 4000 件以上の依存を詰められる。上限が無いと
 * 1リクエストで数千の外部フェッチが走り、Worker のサブリクエスト上限と
 * 実行時間を使い切るうえ、無認証の公開エンドポイントとして濫用される。
 * 実在するプロジェクトの直接依存はまず 200 を超えない。
 */
export const MAX_DEPENDENCIES = 200;

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
    result = { ecosystem: 'npm', dependencies: parsePackageJson(trimmed) };
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
  if (result.dependencies.length > MAX_DEPENDENCIES) {
    throw new Error(
      `This manifest declares ${result.dependencies.length} direct dependencies, above the limit of ${MAX_DEPENDENCIES}. Split it, or use the API for larger projects.`,
    );
  }

  return result;
}
