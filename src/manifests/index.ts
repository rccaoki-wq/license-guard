import { parsePackageJson } from './npm';
import { isPackageLock, parsePackageLock } from './npm-lock';
import { isYarnLock, parseYarnLock } from './yarn-lock';
import { isPnpmLock, parsePnpmLock } from './pnpm-lock';
import { isCargoLock, isPythonLock, parseTomlPackages } from './toml-packages';
import { isCargoToml, parseCargoToml } from './cargo-toml';
import { isGoSum, parseGoSum } from './go-sum';
import { parseRequirementsTxt } from './pypi';
import { parseGoMod } from './gomod';
import type { Dependency, Ecosystem } from '../types';

/**
 * 上流への照会が必要な依存の上限。
 *
 * 費用がかかるのは外部フェッチであって、依存の総数ではない。
 * したがって上限は「解析した依存の数」ではなく、ロックファイルにも
 * 共有キャッシュにも無く実際に問い合わせが要る件数に対して掛ける。
 * 判定は scan() 側で行う（キャッシュの中身はここでは分からないため）。
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
  } else if (isGoSum(trimmed)) {
    result = { ecosystem: 'go', dependencies: parseGoSum(trimmed) };
  } else if (isCargoLock(trimmed)) {
    result = { ecosystem: 'cargo', dependencies: parseTomlPackages(trimmed, 'cargo') };
  } else if (isPythonLock(trimmed)) {
    result = { ecosystem: 'pypi', dependencies: parseTomlPackages(trimmed, 'pypi') };
  } else if (isCargoToml(trimmed)) {
    result = { ecosystem: 'cargo', dependencies: parseCargoToml(trimmed) };
  } else if (isPnpmLock(trimmed)) {
    result = { ecosystem: 'npm', dependencies: parsePnpmLock(trimmed) };
  } else if (isYarnLock(trimmed)) {
    result = { ecosystem: 'npm', dependencies: parseYarnLock(trimmed) };
  } else {
    result = { ecosystem: 'pypi', dependencies: parseRequirementsTxt(trimmed) };
  }

  if (result.dependencies.length === 0) {
    throw new Error(
      'No dependencies were found. Paste a lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, poetry.lock) or a manifest (package.json, requirements.txt, go.mod, Cargo.toml).',
    );
  }

  return result;
}
