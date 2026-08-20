import { fetchJson } from './http';
import { normalizeLicenseString } from '../policy/normalize';
import { categorize } from '../policy/categories';
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
  // 版を欠く総称。最も制約の強い解釈に倒す（permissive と誤るより安全）
  'GNU General Public License (GPL)': 'GPL-3.0-only',
  'GNU Lesser General Public License (LGPL)': 'LGPL-3.0-only',
};

/**
 * 一意に版を決められない分類子。
 * "BSD License" は 2-Clause と 3-Clause のどちらかを区別しない。
 * この場合は自由記述の info.license の方が具体的なことがあるので先に見る。
 */
const AMBIGUOUS_CLASSIFIERS = new Set([
  'BSD License',
  'GNU General Public License (GPL)',
  'GNU Lesser General Public License (LGPL)',
]);

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

/** 自由記述の info.license から、既知の識別子として読める場合のみ取り出す */
function fromFreeText(doc: PypiDoc): string | null {
  const raw = doc.info?.license?.trim();
  if (!raw) return null;

  const normalized = normalizeLicenseString(raw);
  if (categorize(normalized) !== 'unknown') return normalized;
  if (SPDX_SHAPE.test(raw)) return raw;
  return null;
}

function extract(doc: PypiDoc): string | null {
  // PEP 639 の license_expression は正式な SPDX 式であり最も信頼できる。
  // Flask のような最新パッケージは classifiers を持たずこのフィールドのみを持つ。
  const expression = doc.info?.license_expression?.trim();
  if (expression) return expression;

  // classifiers は構造化されており、通常は自由記述より信頼できる。
  // ただし版を特定できない分類子だけは、具体的な自由記述に譲る。
  let ambiguousFallback: string | null = null;
  for (const c of doc.info?.classifiers ?? []) {
    const tail = c.replace(/^License :: (OSI Approved :: )?/, '');
    const spdx = CLASSIFIER_TO_SPDX[tail];
    if (!spdx) continue;

    if (AMBIGUOUS_CLASSIFIERS.has(tail)) {
      ambiguousFallback ??= spdx;
      continue;
    }
    return spdx;
  }

  const free = fromFreeText(doc);
  if (free) return free;

  return ambiguousFallback;
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

