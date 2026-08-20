import { fetchJson } from './http';
import type { LicenseLookup } from './index';

/** PyPI trove classifier → SPDX 識別子 */
const CLASSIFIER_TO_SPDX: Record<string, string> = {
  'MIT License': 'MIT',
  'MIT No Attribution License (MIT-0)': 'MIT-0',
  'Apache Software License': 'Apache-2.0',
  'BSD License': 'BSD-3-Clause',
  'ISC License (ISCL)': 'ISC',
  'GNU General Public License v2 (GPLv2)': 'GPL-2.0-only',
  'GNU General Public License v3 (GPLv3)': 'GPL-3.0-only',
  'GNU General Public License v2 or later (GPLv2+)': 'GPL-2.0-or-later',
  'GNU General Public License v3 or later (GPLv3+)': 'GPL-3.0-or-later',
  'GNU Lesser General Public License v2 (LGPLv2)': 'LGPL-2.0-only',
  'GNU Lesser General Public License v3 (LGPLv3)': 'LGPL-3.0-only',
  'GNU Affero General Public License v3': 'AGPL-3.0-only',
  'GNU Affero General Public License v3 or later (AGPL v3+)': 'AGPL-3.0-or-later',
  'Mozilla Public License 2.0 (MPL 2.0)': 'MPL-2.0',
  'Eclipse Public License 2.0 (EPL-2.0)': 'EPL-2.0',
  'The Unlicense (Unlicense)': 'Unlicense',
  'Python Software Foundation License': 'Python-2.0',
  'zlib/libpng License': 'Zlib',
};

/** SPDX 識別子として妥当な形をしているか（自由記述の除外用） */
const SPDX_SHAPE = /^[A-Za-z0-9.+-]+$/;

interface PypiDoc {
  info?: {
    license?: string | null;
    /** PEP 639 で導入された正式な SPDX 式フィールド */
    license_expression?: string | null;
    classifiers?: string[];
  };
}

function extract(doc: PypiDoc): string | null {
  // PEP 639 の license_expression は正式な SPDX 式であり最も信頼できる。
  // Flask のような最新パッケージは classifiers を持たずこのフィールドのみを持つ。
  const expression = doc.info?.license_expression?.trim();
  if (expression) return expression;

  // classifiers は構造化されており、自由記述の info.license より信頼できる
  for (const c of doc.info?.classifiers ?? []) {
    const tail = c.replace(/^License :: (OSI Approved :: )?/, '');
    const spdx = CLASSIFIER_TO_SPDX[tail];
    if (spdx) return spdx;
  }

  const raw = doc.info?.license?.trim();
  if (raw && SPDX_SHAPE.test(raw)) return raw;

  return null;
}

export async function fetchPypiLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  const base = `https://pypi.org/pypi/${encodeURIComponent(name)}`;

  // 固定版が未公開、または情報を持たない場合は最新に落とす
  if (version !== null) {
    const pinned = await fetchJson<PypiDoc>(
      `${base}/${encodeURIComponent(version)}/json`,
      fetchImpl,
    );
    const spdx = pinned ? extract(pinned) : null;
    if (spdx !== null) return { spdx };
  }

  const doc = await fetchJson<PypiDoc>(`${base}/json`, fetchImpl);
  if (doc === null) return { spdx: null };

  const spdx = extract(doc);
  if (spdx === null) return { spdx: null };
  return version === null ? { spdx } : { spdx, fromLatest: true };
}

