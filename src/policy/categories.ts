import type { LicenseCategory } from '../types';

const EXACT: Record<string, LicenseCategory> = {
  'cc0-1.0': 'public-domain',
  unlicense: 'public-domain',
  '0bsd': 'public-domain',
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
  wtfpl: 'permissive',
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
  if (id.startsWith('cc-by-nc')) return 'non-commercial';
  if (id.startsWith('cc-by-')) return 'permissive';

  return 'unknown';
}
