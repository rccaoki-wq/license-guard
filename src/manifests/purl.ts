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
  version: string | null;
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

  // 版は最後の `@`。ただし位置 0 の `@` は npm の scope（符号化されて
  // いない `pkg:npm/@angular/core`）であって版ではない
  const at = path.lastIndexOf('@');
  if (at > 0) {
    version = decode(path.slice(at + 1)).trim() || null;
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
  return { ecosystem, name, version };
}
