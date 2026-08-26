import { parsePackageJson } from './npm';
import { isPackageLock, parsePackageLock } from './npm-lock';
import { isYarnLock, parseYarnLock } from './yarn-lock';
import { isPnpmLock, parsePnpmLock } from './pnpm-lock';
import { isCargoLock, isPythonLock, parseTomlPackages } from './toml-packages';
import { isCargoToml, parseCargoToml } from './cargo-toml';
import { isPyprojectToml, parsePyprojectToml } from './pyproject';
import { isGoSum, parseGoSum } from './go-sum';
import { isRequirementsTxt, parseRequirementsTxt } from './pypi';
import { isGemfileLock, parseGemfileLock } from './gemfile-lock';
import { isNugetPackagesLock, parseNugetPackagesLock } from './nuget-lock';
import { isNugetProject, parseNugetProject } from './nuget-project';
import { parseGoMod } from './gomod';
import { isCycloneDx, isSpdxJson, parseCycloneDx, parseSpdxJson, type SbomParse } from './sbom';
import type { Dependency, Ecosystem, InputEcosystem } from '../types';

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
  ecosystem: InputEcosystem;
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
  /**
   * SBOM から読んだ場合の、その文書の形式。ロックファイル・マニフェストでは
   * undefined。
   *
   * **`transitive` では足りない。** SBOM も推移的依存まで含むが、
   * ロックファイルとは含み方が違う。ロックファイルの版は*これから
   * install される*版で、SBOM の版は*文書が作られた時点で成果物に
   * 入っていた*版。同じ「全部入り」の顔で書くと嘘になる。
   *
   * **`notes` の有無で代用しないこと。** 対応外の成分が 1 件も無い SBOM は
   * notes が空になりうる（`notes` は「落としたものがある」の記録であって、
   * 「SBOM である」の記録ではない）。
   */
  format?: 'CycloneDX' | 'SPDX';
  /**
   * この入力に固有の限界。パーサだけが知っていて、結果からは復元できないもの。
   *
   * 今のところ SBOM の二つ——対応外の成分を落としたこと、文書が版を
   * 固定していなかったこと。どちらも結果の側では「無い」としか見えず、
   * ここで運ばないと消える。
   */
  notes?: string[];
}

/** 直接依存しか見えなかったときに案内する、そのエコシステムのロックファイル */
export const LOCKFILE_NAME: Record<Ecosystem, string> = {
  npm: 'package-lock.json',
  pypi: 'poetry.lock',
  go: 'go.sum',
  cargo: 'Cargo.lock',
  rubygems: 'Gemfile.lock',
  nuget: 'packages.lock.json',
};

/**
 * GitHub の SBOM API は文書を `{"sbom": …}` で包んで返す。
 *
 * **これは利用者が SBOM を手に入れる一番ありふれた経路。** 包みのまま
 * 貼られると、外側に bomFormat も spdxVersion も無いので SBOM 判定を
 * すり抜け、package.json の受け皿に落ちて「依存が見つかりません」に
 * なる。持っているのが正しい SBOM なのに、対応していないと読める失敗を
 * 返すことになる。
 *
 * 剥がす条件は**中身が自分で形式を名乗っていること**だけにする。
 * `sbom` という名前の欄があるかどうかではない
 */
function unwrapSbom(doc: unknown): unknown {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return doc;
  const inner = (doc as Record<string, unknown>)['sbom'];
  return isCycloneDx(inner) || isSpdxJson(inner) ? inner : doc;
}

/** 「maven (38), deb (3)」——多い順。件数が同じなら名前順で安定させる */
function describeSkipped(skipped: Map<string, number>): string {
  return [...skipped.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, n]) => `${type} (${n})`)
    .join(', ');
}

/**
 * SBOM の読み取り結果を ParsedManifest に写す。
 *
 * ここでしか分からない事実が三つある。**どれも黙ると嘘になる。**
 *
 * 一つ目は混在。系が 2 つ以上あれば `mixed` と名乗る。多数派の名前を
 * 名乗ると、少数派の依存を持つ利用者に対して入力の素性を偽ることになる。
 *
 * 二つ目は落とした成分。対応外の purl type（maven, deb, composer …）は
 * 依存の一覧に痕跡を残さないので、件数を数えて notes に載せる。
 * 載せなければ、Maven 中心の SBOM が「npm の依存 3 件、問題なし」という
 * 検査済みの顔で返る。
 *
 * 三つ目は版が固定されていなかったこと。`^2.0.0` のような範囲は版では
 * ないので落とすが、落とした結果は「版の欄が空」としか見えない。
 * **空欄は不具合と区別がつかない。** 実測では GitHub の SBOM がこの形で、
 * express は 36 件中 36 件、tokio は 63 件中 63 件が範囲だった。
 */
function fromSbom(parsed: SbomParse, format: 'CycloneDX' | 'SPDX'): ParsedManifest {
  const systems = new Set(parsed.dependencies.map((d) => d.ecosystem));
  const notes: string[] = [];

  if (parsed.skipped.size > 0) {
    const total = [...parsed.skipped.values()].reduce((a, b) => a + b, 0);
    notes.push(
      `${total === 1 ? '1 component was' : `${total} components were`} left out because this scan does not cover ${total === 1 ? 'its package type' : 'their package types'}: ${describeSkipped(parsed.skipped)}. They are not counted anywhere in this result.`,
    );
  }

  if (parsed.ranged > 0) {
    const all = parsed.ranged === parsed.dependencies.length;
    const subject = all
      ? 'Every component in this document records'
      : `${parsed.ranged} of ${parsed.dependencies.length} components in this document record`;
    notes.push(
      `${subject} a version range such as "^2.0.0" instead of the version actually in the artifact. A range is not a version, so ${all ? 'no version is' : 'those versions are not'} shown and ${all ? 'every license was' : 'their licenses were'} read from the current release rather than the one you are shipping. A bill of materials that does not pin versions cannot tell you which release you have. GitHub's dependency-graph export has this shape; a lockfile does not.`,
    );
  }

  if (parsed.dependencies.length === 0) {
    const detail =
      parsed.skipped.size === 0
        ? 'It lists no components.'
        : `Every component uses a package type this scan does not cover: ${describeSkipped(parsed.skipped)}.`;
    throw new Error(
      `This is a ${format} document, but nothing in it can be checked. ${detail} Supported package types: npm, pypi, golang, cargo, gem, nuget.`,
    );
  }

  const ecosystem: InputEcosystem = systems.size === 1 ? [...systems][0]! : 'mixed';
  return {
    ecosystem,
    dependencies: parsed.dependencies,
    // SBOM は成果物の目録なので、推移的依存まで含んでいる前提で書かれる
    transitive: true,
    format,
    notes,
  };
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
    const doc: unknown = unwrapSbom(JSON.parse(trimmed));
    // **SBOM を最初に見る。** CycloneDX も SPDX も `{` で始まり、
    // `dependencies` や `packages` という欄を持ちうる。後ろに置くと
    // npm や NuGet の判定に先に捕まり、別形式として読まれる。
    // どちらも文書自身が形式を名乗る欄（bomFormat / spdxVersion）を
    // 持っているので、判定は形ではなく宣言で行う
    result = isCycloneDx(doc)
      ? fromSbom(parseCycloneDx(doc), 'CycloneDX')
      : isSpdxJson(doc)
        ? fromSbom(parseSpdxJson(doc), 'SPDX')
        : isPackageLock(doc)
          ? { ecosystem: 'npm', dependencies: parsePackageLock(trimmed), transitive: true }
          : // packages.lock.json も `{` で始まり `dependencies` を持つ。
            // **npm の判定より後、package.json の受け皿より前。** 後ろに置くと
            // 依存 0 件として弾かれ、NuGet の利用者には「対応していない」と
            // 区別が付かない形で失敗する
            isNugetPackagesLock(doc)
            ? {
                ecosystem: 'nuget',
                dependencies: parseNugetPackagesLock(trimmed),
                transitive: true,
              }
            : { ecosystem: 'npm', dependencies: parsePackageJson(trimmed), transitive: false };
  } else if (isNugetProject(trimmed)) {
    // XML なので他の形式と紛れない。判定は `<PackageReference>` /
    // `<PackageVersion>` / `<package id=>` の実在だけを見る。
    // .csproj は推移的依存を持たない——実際に入る版は restore が決める
    result = { ecosystem: 'nuget', dependencies: parseNugetProject(trimmed), transitive: false };
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
  } else if (isPyprojectToml(trimmed)) {
    result = { ecosystem: 'pypi', dependencies: parsePyprojectToml(trimmed), transitive: false };
  } else if (isCargoToml(trimmed)) {
    result = { ecosystem: 'cargo', dependencies: parseCargoToml(trimmed), transitive: false };
  } else if (isPnpmLock(trimmed)) {
    result = { ecosystem: 'npm', dependencies: parsePnpmLock(trimmed), transitive: true };
  } else if (isYarnLock(trimmed)) {
    result = { ecosystem: 'npm', dependencies: parseYarnLock(trimmed), transitive: true };
  } else if (isGemfileLock(trimmed)) {
    // **requirements.txt の判定より前に置くこと。** Gemfile.lock は
    // 行頭の語がそのまま名前に見えるので、後ろに置くと以前と同じく
    // `GEM` `PLATFORMS` という PyPI パッケージのレポートが返る
    result = {
      ecosystem: 'rubygems',
      dependencies: parseGemfileLock(trimmed),
      transitive: true,
    };
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
      'This does not look like any supported manifest, lockfile, or SBOM. Supported: package.json, package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, pyproject.toml, poetry.lock, go.mod, go.sum, Cargo.toml, Cargo.lock, Gemfile.lock, packages.lock.json, .csproj, Directory.Packages.props, packages.config, CycloneDX (JSON), SPDX (JSON).',
    );
  }

  if (result.dependencies.length === 0) {
    throw new Error(
      'No dependencies were found. Paste a lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, poetry.lock, Gemfile.lock, packages.lock.json), an SBOM (CycloneDX or SPDX, JSON), or a manifest (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, .csproj).',
    );
  }

  return result;
}
