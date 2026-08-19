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
  'mpl-2.0': 'weak-copyleft',
  'epl-1.0': 'weak-copyleft',
  'epl-2.0': 'weak-copyleft',
  'cddl-1.0': 'weak-copyleft',
  'cddl-1.1': 'weak-copyleft',
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
  if (id.startsWith('lgpl-')) return 'weak-copyleft';
  if (id.startsWith('gpl-')) return 'strong-copyleft';
  if (id.startsWith('cc-by-nc')) return 'non-commercial';
  if (id.startsWith('cc-by-')) return 'permissive';

  return 'unknown';
}
