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
  // Python 本体系。**上位 300 PyPI で最多ダウンロードの typing-extensions が
  // PSF-2.0 を宣言している。** ここが空だと、Python エコシステムの
  // 一番上にあるパッケージが「要確認」で返る
  'psf-2.0': 'permissive',
  'cnri-python': 'permissive',
  'cnri-python-gpl-compatible': 'permissive',
  'mit-cmu': 'permissive',
  // Community Data License Agreement の permissive 版。Rust の TLS スタック
  // （webpki-roots / webpki-root-certs）が実際に使っている
  'cdla-permissive-1.0': 'permissive',
  'cdla-permissive-2.0': 'permissive',
  hpnd: 'permissive',
  'upl-1.0': 'permissive',
  'w3c': 'permissive',
  miros: 'permissive',
  'mulanpsl-2.0': 'permissive',
  // Apache-2.0 に教育機関向けの特許条項を足したもの
  'ecl-2.0': 'permissive',
  'zpl-2.1': 'permissive',
  'vsl-1.0': 'permissive',
  // 表示を UI に出すことを求める BSD 系。義務は attribution で足りる
  aal: 'permissive',
  // **CECILL は B / C / 2.1 で強さが違う。** 名前が 1 文字しか違わないので、
  // ひとまとめにすると BSD 相当と GPL 相当が同じ扱いになる
  'cecill-b': 'permissive',
  'cecill-c': 'library-copyleft',
  'cecill-2.1': 'strong-copyleft',
  'ms-pl': 'file-copyleft',
  'mpl-2.0': 'file-copyleft',
  'mpl-1.1': 'file-copyleft',
  'epl-1.0': 'file-copyleft',
  'epl-2.0': 'file-copyleft',
  'cddl-1.0': 'file-copyleft',
  'cddl-1.1': 'file-copyleft',
  // MPL の系譜（MPL-1.0 → NPL/SPL/RSCPL）と、EPL の祖先（CPL/IPL）。
  // いずれも改変したファイルのソース提供までを求め、リンクした側には及ばない
  'mpl-1.0': 'file-copyleft',
  'npl-1.1': 'file-copyleft',
  'spl-1.0': 'file-copyleft',
  'rscpl': 'file-copyleft',
  'cpl-1.0': 'file-copyleft',
  'ipl-1.0': 'file-copyleft',
  'motosoto': 'file-copyleft',
  'ogtsl': 'file-copyleft',
  // **SIL Open Font License はフォントに閉じたコピーレフト。** 改変した
  // フォントは OFL のままだが、そのフォントを使うプログラムには及ばない。
  // permissive に置くと、フォント自体を再配布するときの条件が消える
  'ofl-1.1': 'file-copyleft',
  'ofl-1.0': 'file-copyleft',
  // **Sleepycat（Berkeley DB）は permissive ではない。** 分類子表では
  // permissive な名前に囲まれて並んでいるが、これを使うアプリケーションは
  // **全体のソース公開を求められる。** 並びで倒すと最も強い部類を素通しする
  sleepycat: 'strong-copyleft',
  // NetHack GPL。前文が違うだけで条件は GPL と同じ
  ngpl: 'strong-copyleft',
  // QPL 6条は、リンクする側のプログラムを自由に再配布可能にすることを求める
  'qpl-1.0': 'strong-copyleft',
  // **ネットワーク越しの利用を配布とみなすもの。** AGPL 13条と同じ引き金で、
  // SaaS で使った時点で義務が発火する。
  // OSL-3.0 §5 "External Deployment"、EUPL 13条/14条（Communication of the Work）。
  // review に落とすのは「安全側」ではなく、AGPL を見逃すのと同じ過小警告になる
  'osl-3.0': 'network-copyleft',
  'osl-2.1': 'network-copyleft',
  'eupl-1.0': 'network-copyleft',
  'eupl-1.1': 'network-copyleft',
  'eupl-1.2': 'network-copyleft',
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
