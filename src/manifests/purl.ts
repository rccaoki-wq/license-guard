import type { Ecosystem } from '../types';

/**
 * purl の type → このスキャナが照会できるエコシステム。
 *
 * **ここに無い type は「非対応」であって「存在しない」ではない。**
 * SBOM は 1 文書に複数の系が同居するので、Maven や deb の成分を黙って
 * 落とすと、Java のプロジェクトが「依存 0 件」という顔の答えを受け取る。
 * 呼び出し側が件数を数えて開示できるよう、null を返して区別させる。
 */
const PURL_TYPE: Record<string, Ecosystem> = {
  npm: 'npm',
  pypi: 'pypi',
  golang: 'go',
  cargo: 'cargo',
  gem: 'rubygems',
  nuget: 'nuget',
};

export interface ParsedPurl {
  ecosystem: Ecosystem;
  name: string;
  /** 実在しうる 1 点の版。範囲だったときは null（`range` に入る） */
  version: string | null;
  /**
   * 版の位置に**範囲**が書かれていたときの原文。
   *
   * purl の版は 1 点であることになっているが、GitHub の
   * dependency-graph は `pkg:npm/accepts@%5E2.0.0` のように
   * マニフェストの範囲をそのまま入れてくる（実測: express の
   * 全 36 件、tokio の全 63 件がこの形）。
   *
   * **これを版として通すと二重に嘘をつく。** レジストリには
   * `^2.0.0` という版が無いので固定版の照会が必ず空振りし、
   * 最新版に落ちて「固定版に license が無かった」という別の
   * 理由の注記が付く。加えて報告の版欄に `>= 0.2.42,< 0.3.0`
   * と印字される。範囲は版ではないので版として扱わない。
   *
   * 呼び出し側は件数を数えて「文書が版を固定していなかった」
   * ことを開示する。黙って空欄にすると壊れて見える
   */
  range: string | null;
}

/**
 * 範囲を表す記号。1 つでも含まれていれば 1 点の版ではない。
 *
 * 版の文法は系ごとに違う（Go の `v1.8.1`、PyPI の `2.31.0.post1`、
 * SemVer の `1.0.0-rc.1+build`）ので、**「版の形か」ではなく
 * 「範囲の形か」で見る。** 六つの系の版文法を自前で持つと、
 * 正しい版を弾いて静かに 1 件落とす側に倒れる
 */
const RANGE = /[\s,|*^~<>=]/;

/**
 * 「1 点の版ではない」ことの判定。purl の版欄だけでなく、CycloneDX の
 * `version` 欄と SPDX の `versionInfo` にも同じ範囲が入ってくるので、
 * 判定を 1 か所に置いて両方から使う
 */
export function isVersionRange(raw: string): boolean {
  return RANGE.test(raw);
}

/** 壊れた入力で例外を投げない percent-decode。読めなければ元の文字列 */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * purl の type だけを取り出す。対応・非対応にかかわらず返す。
 * 非対応の成分を「何が何件あったか」で開示するために使う。
 */
export function purlType(purl: string): string | null {
  const m = /^pkg:\/*([A-Za-z][A-Za-z0-9.+-]*)\//.exec(purl.trim());
  return m === null ? null : m[1]!.toLowerCase();
}

/**
 * package-URL を、このスキャナの座標（系・名前・版）に写す。
 * 対応していない type、または形が purl でないものは null。
 *
 * 名前の組み立ては系ごとに違う。**共通の規則にできない。**
 * Go のモジュールパスは `namespace/name` を繋いだもの（`github.com/gorilla` +
 * `mux`）で、これがそのまま照会に使う識別子になる。npm の scope も
 * 繋ぐが、`@` は purl では `%40` に符号化されている。NuGet に namespace は
 * 無い。繋ぎ方を一つに揃えると、どれかの系で必ず存在しない名前を作る。
 */
export function parsePurl(purl: string): ParsedPurl | null {
  const trimmed = purl.trim();
  if (!/^pkg:/i.test(trimmed)) return null;

  // qualifiers と subpath は座標に関係しない。`?` `#` の順は spec 上
  // 固定だが、先に `#` を落としてから `?` を落とせば順序に依らない
  const body = trimmed.slice(4).replace(/^\/+/, '').split('#')[0]!.split('?')[0]!;

  const slash = body.indexOf('/');
  if (slash <= 0) return null;

  const ecosystem = PURL_TYPE[body.slice(0, slash).toLowerCase()];
  if (ecosystem === undefined) return null;

  let path = body.slice(slash + 1);
  let version: string | null = null;
  let range: string | null = null;

  // 版は最後の `@`。ただし位置 0 の `@` は npm の scope（符号化されて
  // いない `pkg:npm/@angular/core`）であって版ではない
  const at = path.lastIndexOf('@');
  if (at > 0) {
    const raw = decode(path.slice(at + 1)).trim() || null;
    if (raw !== null && isVersionRange(raw)) range = raw;
    else version = raw;
    path = path.slice(0, at);
  }

  const segments = path
    .split('/')
    .filter((s) => s !== '')
    .map(decode);
  if (segments.length === 0) return null;

  // namespace と name の繋ぎ方は系ごと。NuGet と Cargo と PyPI に
  // namespace は無いので、余分な段があればそれは purl の側が壊れている
  const name =
    ecosystem === 'go' || ecosystem === 'npm' ? segments.join('/') : segments[segments.length - 1]!;

  if (name === '') return null;
  return { ecosystem, name, version, range };
}
