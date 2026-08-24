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
  /**
   * 推移的依存まで含んでいるか。**どのパーサを通ったかでしか決まらない。**
   *
   * これを Finding の `resolvedFrom` から推測していた時期があり、
   * ロックファイルを貼った利用者に「ロックファイルを貼れ」と返していた。
   * `resolvedFrom` はライセンスをどこから読んだかで、npm はロックファイルに
   * ライセンスを書かないため、ほぼ常に `registry` になる。**別の事実である。**
   */
  transitive: boolean;
}

/** 直接依存しか見えなかったときに案内する、そのエコシステムのロックファイル */
export const LOCKFILE_NAME: Record<Ecosystem, string> = {
  npm: 'package-lock.json',
  pypi: 'poetry.lock',
  go: 'go.sum',
  cargo: 'Cargo.lock',
};

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
      ? { ecosystem: 'npm', dependencies: parsePackageLock(trimmed), transitive: true }
      : { ecosystem: 'npm', dependencies: parsePackageJson(trimmed), transitive: false };
  } else if (/^module\s+\S+/m.test(trimmed) || /^require\s*\(/m.test(trimmed)) {
    result = { ecosystem: 'go', dependencies: parseGoMod(trimmed), transitive: false };
  } else if (isGoSum(trimmed)) {
    result = { ecosystem: 'go', dependencies: parseGoSum(trimmed), transitive: true };
  } else if (isCargoLock(trimmed)) {
    result = {
      ecosystem: 'cargo',
      dependencies: parseTomlPackages(trimmed, 'cargo'),
      transitive: true,
    };
  } else if (isPythonLock(trimmed)) {
    result = {
      ecosystem: 'pypi',
      dependencies: parseTomlPackages(trimmed, 'pypi'),
      transitive: true,
    };
  } else if (isCargoToml(trimmed)) {
    result = { ecosystem: 'cargo', dependencies: parseCargoToml(trimmed), transitive: false };
  } else if (isPnpmLock(trimmed)) {
    result = { ecosystem: 'npm', dependencies: parsePnpmLock(trimmed), transitive: true };
  } else if (isYarnLock(trimmed)) {
    result = { ecosystem: 'npm', dependencies: parseYarnLock(trimmed), transitive: true };
  } else {
    // requirements.txt は pip freeze なら実質完全だが、内容からは区別できない。
    // 分からないときは「見えていない依存があるかもしれない」側に倒す
    result = { ecosystem: 'pypi', dependencies: parseRequirementsTxt(trimmed), transitive: false };
  }

  if (result.dependencies.length === 0) {
    throw new Error(
      'No dependencies were found. Paste a lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, poetry.lock) or a manifest (package.json, requirements.txt, go.mod, Cargo.toml).',
    );
  }

  return result;
}
