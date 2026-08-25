import { parsePackageJson } from './npm';
import { isPackageLock, parsePackageLock } from './npm-lock';
import { isYarnLock, parseYarnLock } from './yarn-lock';
import { isPnpmLock, parsePnpmLock } from './pnpm-lock';
import { isCargoLock, isPythonLock, parseTomlPackages } from './toml-packages';
import { isCargoToml, parseCargoToml } from './cargo-toml';
import { isGoSum, parseGoSum } from './go-sum';
import { isRequirementsTxt, parseRequirementsTxt } from './pypi';
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
 *
 * **何がこの数字を決めているか。** かつては実行時間だった。固定幅バッチと
 * 1 件ずつのキャッシュ往復で 200 件に約 18 秒かかり、20 秒の予算をほぼ
 * 使い切っていた（実測: nushell 911 件で 32% が未確認）。滑走窓と
 * 一括キャッシュに変えて 338 件・完全新規が 3.6 秒になり、時間は
 * 律速でなくなった。
 *
 * 今の律速は Worker の**サブリクエスト上限（1000/リクエスト）**。
 * 1 件あたりの外部フェッチは最悪 3 回（Go は deps.dev → goproxy →
 * ClearlyDefined、crates.io は固定版が空振りすると基底 URL へもう一度）。
 * 300 × 3 = 900 で枠に収まる。これ以上は時間ではなく上限に当たって
 * 落ちるので、上げるなら先にフェッチ回数の方を減らすこと。
 */
export const MAX_LOOKUPS = 300;

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
  } else if (isRequirementsTxt(trimmed)) {
    // requirements.txt は pip freeze なら実質完全だが、内容からは区別できない。
    // 分からないときは「見えていない依存があるかもしれない」側に倒す
    result = { ecosystem: 'pypi', dependencies: parseRequirementsTxt(trimmed), transitive: false };
  } else {
    // **ここを requirements.txt の受け皿にしないこと。**
    // かつては無条件に requirements.txt として読んでいたため、Gemfile.lock や
    // build.gradle を貼ると行頭の語がパッケージ名になり、何も検査できて
    // いないのに普通のレポートが返っていた。分からないなら分からないと言う
    throw new Error(
      'This does not look like any supported manifest or lockfile. Supported: package.json, package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, poetry.lock, go.mod, go.sum, Cargo.toml, Cargo.lock.',
    );
  }

  if (result.dependencies.length === 0) {
    throw new Error(
      'No dependencies were found. Paste a lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, poetry.lock) or a manifest (package.json, requirements.txt, go.mod, Cargo.toml).',
    );
  }

  return result;
}
