import type { LicenseCategory } from '../types';

const EXACT: Record<string, LicenseCategory> = {
  'cc0-1.0': 'public-domain',
  unlicense: 'public-domain',
  '0bsd': 'public-domain',
  // WTFPL の条項は「好きにしろ」の1つだけで、著作権表示の保持を求めない。
  // permissive に置くと存在しない表示義務を作り出す
  wtfpl: 'public-domain',
  // **npm の "UNLICENSED" は "Unlicense" ではない。** 前者は
  // 「このパッケージにライセンスを与えない」という宣言で、後者は
  // パブリックドメインへの放棄。1文字違いで意味が正反対になる。
  // ここを取り違えると、非公開パッケージが allowed で返る
  unlicensed: 'none',
  mit: 'permissive',
  'mit-0': 'permissive',
  isc: 'permissive',
  'bsd-2-clause': 'permissive',
  'bsd-3-clause': 'permissive',
  'apache-2.0': 'permissive',
  zlib: 'permissive',
  'python-2.0': 'permissive',
  postgresql: 'permissive',
  'blueoak-1.0.0': 'permissive',
  // golang.org/x/* に付随する Go の PATENTS。権利を付与する追加許諾であり
  // 制限ではない。未知として扱うと Go プロジェクトの大半が要確認になる。
  'licenseref-scancode-google-patent-license-golang': 'permissive',
  // BSL-1.0 は Boost Software License（permissive）。
  // Business Source License の BSL-1.1 / BUSL-1.1 とは別物なので取り違えないこと。
  'bsl-1.0': 'permissive',
  'artistic-2.0': 'permissive',
  ncsa: 'permissive',
  x11: 'permissive',
  libpng: 'permissive',
  ruby: 'permissive',
  'afl-3.0': 'permissive',
  'apache-1.1': 'permissive',
  'bsd-3-clause-clear': 'permissive',
  'bsd-4-clause': 'permissive',
  'unicode-dfs-2016': 'permissive',
  'unicode-3.0': 'permissive',
  'unicode-dfs-2015': 'permissive',
  'bsd-3-clause-no-nuclear-license': 'permissive',
  'mit-modern-variant': 'permissive',
  'openssl': 'permissive',
  'php-3.01': 'permissive',
  'ms-pl': 'file-copyleft',
  'mpl-2.0': 'file-copyleft',
  'mpl-1.1': 'file-copyleft',
  'epl-1.0': 'file-copyleft',
  'epl-2.0': 'file-copyleft',
  'cddl-1.0': 'file-copyleft',
  'cddl-1.1': 'file-copyleft',
  'sspl-1.0': 'source-available',
  'busl-1.1': 'source-available',
  'bsl-1.1': 'source-available',
  'elastic-2.0': 'source-available',
};

/**
 * SPDX ライセンス識別子をカテゴリに分類する。
 * 判定不能な場合は 'unknown' を返す（呼び出し側で 'review' に倒すこと）。
 */
export function categorize(licenseId: string): LicenseCategory {
  const id = licenseId.trim().toLowerCase();
  if (id === '') return 'none';

  const exact = EXACT[id];
  if (exact) return exact;

  // AGPL は GPL より先に判定する（"agpl" は "gpl" を含むため）
  if (id.startsWith('agpl-')) return 'network-copyleft';
  if (id.startsWith('lgpl-')) return 'library-copyleft';
  if (id.startsWith('gpl-')) return 'strong-copyleft';

  // 版を伴わない総称。SPDX 識別子ではないが、上流のメタデータには実在する
  // （PyPI の "GNU General Public License (GPL)" 分類子など）。
  //
  // **版を勝手に補わないこと。** v2 と v3 は互いに非互換なので、
  // 分からない版を具体的に名乗るのは「厳しい方に倒す」ではなく別物の主張。
  // 実際 mysql-connector-python は GPLv2 + FOSS 例外なのに GPL-3.0-only と
  // 答えていた。族だけは確かなので、族だけを答える
  if (id === 'agpl') return 'network-copyleft';
  if (id === 'lgpl') return 'library-copyleft';
  if (id === 'gpl') return 'strong-copyleft';
  // Creative Commons は条件の組み合わせで別物になる。接尾辞を見ずに
  // 「CC-BY 系だから permissive」と倒すと、コピーレフトと改変禁止が
  // まとめて許可になる。厳しい条件から順に判定すること
  if (id.startsWith('cc-by-nc')) return 'non-commercial';
  if (id.startsWith('cc-by-nd')) return 'no-derivatives';
  // ShareAlike は改変物を同じ条件で配ることを要求する。CC 自身が
  // BY-SA 4.0 から GPL-3.0 への一方向互換を宣言しており、強いコピーレフトと
  // 同等に扱われている
  if (id.startsWith('cc-by-sa')) return 'strong-copyleft';
  if (id.startsWith('cc-by-')) return 'permissive';

  return 'unknown';
}
