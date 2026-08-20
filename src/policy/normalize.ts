/**
 * SPDX として解釈できない歴史的な表記を SPDX 識別子に寄せる。
 *
 * npm の license フィールドが SPDX 式に統一されたのは 2014 年頃で、
 * それ以前の "MIT/X11" や "BSD" といった表記が今も残っている。
 * これらを未知として扱うと、実際には permissive なパッケージが
 * 「要確認」に積み上がり、警告全体が無視されるようになる。
 *
 * 族の総称（"GPL" のようにバージョンを欠くもの）は、その族に共通する
 * 最も制約の強い性質に倒す。permissive と誤って判定するより、
 * 過剰に慎重な側で誤る方が損害が小さいため。
 */
const LEGACY_ALIASES: Record<string, string> = {
  // 旧 npm のスラッシュ表記
  'mit/x11': 'MIT',
  'mit / x11': 'MIT',
  x11: 'X11',
  'bsd*': 'BSD-3-Clause',

  // バージョンを欠く族の総称
  bsd: 'BSD-3-Clause',
  'new bsd': 'BSD-3-Clause',
  'new bsd license': 'BSD-3-Clause',
  'simplified bsd': 'BSD-2-Clause',
  'bsd license': 'BSD-3-Clause',
  apache: 'Apache-2.0',
  'apache 2': 'Apache-2.0',
  'apache 2.0': 'Apache-2.0',
  'apache license': 'Apache-2.0',
  'apache software license': 'Apache-2.0',
  'asl 2.0': 'Apache-2.0',
  mit: 'MIT',
  'mit license': 'MIT',
  isc: 'ISC',
  gpl: 'GPL-3.0-only',
  'gpl-2': 'GPL-2.0-only',
  'gpl-3': 'GPL-3.0-only',
  lgpl: 'LGPL-3.0-only',
  agpl: 'AGPL-3.0-only',
  mpl: 'MPL-2.0',
  epl: 'EPL-2.0',
  zlib: 'Zlib',

  // パブリックドメイン表明
  'public domain': 'CC0-1.0',
  'public-domain': 'CC0-1.0',
  unlicensed: 'CC0-1.0',
  cc0: 'CC0-1.0',
  wtfpl: 'WTFPL',
};

/**
 * 単一のライセンス表記を正規化する。
 * SPDX 式（OR / AND / WITH を含むもの）はパーサに任せるため触らない。
 * 未知の文字列はそのまま返す。勝手に決めつけない。
 */
export function normalizeLicenseString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return trimmed;

  // 式として書かれているものは分解せずパーサへ渡す
  if (/[()]|\s(OR|AND|WITH)\s/i.test(trimmed)) return trimmed;

  return LEGACY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
