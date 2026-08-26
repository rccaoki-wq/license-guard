import { isSafePackageName } from './name-safety';
import type { Dependency } from '../types';

/**
 * Gemfile.lock を解析する。
 *
 * 形はこう。**列 0 の大文字語が節**で、`specs:` の下だけが実体の一覧。
 *
 *   GIT
 *     remote: https://github.com/foo/bar.git
 *     specs:
 *       bar (1.0.0)
 *   GEM
 *     remote: https://rubygems.org/
 *     specs:
 *       actioncable (7.1.3)
 *         actionpack (= 7.1.3)     ← これは制約であって実体ではない
 *       nokogiri (1.16.0-arm64-darwin)
 *   CHECKSUMS
 *     actioncable (7.1.3) sha256=...
 *   DEPENDENCIES
 *     rails (~> 7.1.3)
 *
 * **`specs:` の下という条件を外してはいけない。** `CHECKSUMS` 節は
 * 見た目がまったく同じ `名前 (版)` を同じ深さで並べており、節を見ずに
 * 拾うと全件が二重に出る。`DEPENDENCIES` 節の方は範囲指定なので
 * 版が確定せず、拾えば「版なし」の照会に化ける。
 *
 * 6 スペース以上の行はその gem の依存制約で、実体としては同じ節の
 * 4 スペースの行に必ず現れる。ここで拾うと版が `(= 7.1.3)` のような
 * 制約文字列になる。
 *
 * Gemfile.lock は**解決済みの全体**を記録するので推移的依存まで見える。
 * ただし **group（:development / :test）は Gemfile 側にしか無い**ため、
 * ここからは scope を区別できない。推測せず全部 runtime にする——
 * 実行時でないものを実行時と扱うのは過剰警告で済むが、逆は見落としになる。
 */

/** `nokogiri (1.16.0-arm64-darwin)` のような 1 行から名前と版を取る */
const SPEC_LINE = /^(\S+) \(([^()]+)\)$/;

/**
 * 版からプラットフォーム接尾辞を落とす。
 *
 * Gem の版は数字とドットだけで、**ハイフンから先は必ずプラットフォーム**
 * （`1.16.0-arm64-darwin`）。プレリリースはドット区切り（`1.0.0.rc1`）
 * なので、ハイフンで切っても壊れない。付けたまま照会すると存在しない
 * 座標になり、解決できるはずの gem が毎回空振りする。
 */
function stripPlatform(version: string): string {
  const cut = version.indexOf('-');
  return cut === -1 ? version : version.slice(0, cut);
}

type Section = 'gem' | 'git' | 'path' | 'other';

function sectionOf(header: string): Section {
  if (header === 'GEM') return 'gem';
  if (header === 'GIT') return 'git';
  if (header === 'PATH') return 'path';
  return 'other';
}

export function parseGemfileLock(content: string): Dependency[] {
  const found = new Map<string, Dependency>();

  let section: Section = 'other';
  let inSpecs = false;
  /** その GEM 節の remote が rubygems.org かどうか */
  let publicRemote = true;

  for (const raw of content.split(/\r?\n/)) {
    if (raw.trim() === '') {
      inSpecs = false;
      continue;
    }

    // 列 0 は節の見出し
    if (!/^\s/.test(raw)) {
      section = sectionOf(raw.trim());
      inSpecs = false;
      publicRemote = true;
      continue;
    }

    const line = raw.trim();

    if (line === 'specs:') {
      inSpecs = true;
      continue;
    }

    if (line.startsWith('remote:')) {
      const remote = line.slice('remote:'.length).trim();
      publicRemote = /^https?:\/\/(www\.)?rubygems\.org\/?$/.test(remote);
      continue;
    }

    if (!inSpecs) continue;

    // 4 スペースが実体、6 スペース以上はその gem の依存制約
    const indent = raw.length - raw.trimStart().length;
    if (indent !== 4) continue;

    const m = SPEC_LINE.exec(line);
    if (m === null) continue;

    const [, name, rawVersion] = m as unknown as [string, string, string];
    if (!isSafePackageName(name)) continue;

    const version = stripPlatform(rawVersion.trim());
    if (!/^\d/.test(version)) continue;

    // 同じ gem が複数プラットフォーム分並ぶことがある（版は同じ）
    if (found.has(name)) continue;

    found.set(name, {
      ecosystem: 'rubygems',
      name,
      version,
      scope: 'runtime',
      origin:
        section === 'git'
          ? 'git'
          : section === 'path'
            ? 'workspace'
            : publicRemote
              ? 'registry'
              : 'other-registry',
    });
  }

  return [...found.values()];
}

/**
 * Gemfile.lock かどうかを内容だけで判定する。
 *
 * `specs:` と列 0 の `DEPENDENCIES` の同居は他の形式に無い。
 * 節の見出しだけで判定すると、`GEM` の 3 文字を含む別物を拾いうる。
 */
export function isGemfileLock(content: string): boolean {
  return /^\s+specs:$/m.test(content) && /^DEPENDENCIES$/m.test(content);
}
