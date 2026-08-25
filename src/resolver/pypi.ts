import { fetchJson } from './http';
import { normalizeLicenseString } from '../policy/normalize';
import { categorize } from '../policy/categories';
import type { LicenseLookup } from './index';

/**
 * PyPI trove classifier → SPDX 識別子。
 *
 * **見出しは PyPI が実際に出す文字列と一字一句同じにすること。**
 * 存在しない綴りを鍵にしても型エラーにも例外にもならず、その行は
 * 永久に発火しない。実際 `GNU Lesser General Public License (LGPL)` と
 * 書いていたが、PyPI が出すのは
 * `GNU Library or Lesser General Public License (LGPL)` で、
 * LGPL を宣言したパッケージが全て「判定不能」に落ちていた。
 * tests/fixtures/pypi-license-classifiers.txt が公式の一覧で、
 * テストがそれとの差分を見張っている。
 */
export const CLASSIFIER_TO_SPDX: Record<string, string> = {
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
  'GNU Lesser General Public License v2 or later (LGPLv2+)': 'LGPL-2.0-or-later',
  'GNU Lesser General Public License v3 (LGPLv3)': 'LGPL-3.0-only',
  'GNU Lesser General Public License v3 or later (LGPLv3+)': 'LGPL-3.0-or-later',
  'GNU Affero General Public License v3': 'AGPL-3.0-only',
  'GNU Affero General Public License v3 or later (AGPLv3+)': 'AGPL-3.0-or-later',
  'Mozilla Public License 1.0 (MPL)': 'MPL-1.0',
  'Mozilla Public License 1.1 (MPL 1.1)': 'MPL-1.1',
  'Mozilla Public License 2.0 (MPL 2.0)': 'MPL-2.0',
  'Common Development and Distribution License 1.0 (CDDL-1.0)': 'CDDL-1.0',
  'Eclipse Public License 1.0 (EPL-1.0)': 'EPL-1.0',
  'Eclipse Public License 2.0 (EPL-2.0)': 'EPL-2.0',
  'European Union Public Licence 1.0 (EUPL 1.0)': 'EUPL-1.0',
  'European Union Public Licence 1.1 (EUPL 1.1)': 'EUPL-1.1',
  'European Union Public Licence 1.2 (EUPL 1.2)': 'EUPL-1.2',
  'Open Software License 3.0 (OSL-3.0)': 'OSL-3.0',
  'Common Public License': 'CPL-1.0',
  'IBM Public License': 'IPL-1.0',
  'Sun Public License': 'SPL-1.0',
  'Netscape Public License (NPL)': 'NPL-1.1',
  'Nethack General Public License': 'NGPL',
  'Qt Public License (QPL)': 'QPL-1.0',
  'Sleepycat License': 'Sleepycat',
  'Artistic License': 'Artistic-1.0',
  'The Unlicense (Unlicense)': 'Unlicense',
  'CC0 1.0 Universal (CC0 1.0) Public Domain Dedication': 'CC0-1.0',
  'Python Software Foundation License': 'Python-2.0',
  'Python License (CNRI Python License)': 'CNRI-Python',
  'zlib/libpng License': 'Zlib',
  'Zero-Clause BSD (0BSD)': '0BSD',
  'Boost Software License 1.0 (BSL-1.0)': 'BSL-1.0',
  'CMU License (MIT-CMU)': 'MIT-CMU',
  'Historical Permission Notice and Disclaimer (HPND)': 'HPND',
  'University of Illinois/NCSA Open Source License': 'NCSA',
  'SIL Open Font License 1.1 (OFL-1.1)': 'OFL-1.1',
  'PostgreSQL License': 'PostgreSQL',
  'Universal Permissive License (UPL)': 'UPL-1.0',
  'W3C License': 'W3C',
  'Zope Public License': 'ZPL-2.1',
  'MirOS License (MirOS)': 'MirOS',
  'Blue Oak Model License (BlueOak-1.0.0)': 'BlueOak-1.0.0',
  'Mulan Permissive Software License v2 (MulanPSL-2.0)': 'MulanPSL-2.0',
  'Academic Free License (AFL)': 'AFL-3.0',
  'Educational Community License, Version 2.0 (ECL-2.0)': 'ECL-2.0',
  'Attribution Assurance License': 'AAL',
  'Open Group Test Suite License': 'OGTSL',
  'Motosoto License': 'Motosoto',
  'Vovida Software License 1.0': 'VSL-1.0',
  'Ricoh Source Code Public License': 'RSCPL',
  'NASA Open Source Agreement v1.3 (NASA-1.3)': 'NASA-1.3',
  'Aladdin Free Public License (AFPL)': 'Aladdin',
  'CeCILL-B Free Software License Agreement (CECILL-B)': 'CECILL-B',
  'CeCILL-C Free Software License Agreement (CECILL-C)': 'CECILL-C',
  'CEA CNRS Inria Logiciel Libre License, version 2.1 (CeCILL-2.1)': 'CECILL-2.1',
};

/**
 * 版を書かない分類子 → 族の名前。**SPDX 識別子ではない。**
 *
 * かつてこれらを `GPL-3.0-only` / `LGPL-3.0-only` に寄せていた。
 * 「版が分からないなら厳しい方へ」という理屈だったが、これは誤り。
 * GPLv2 と GPLv3 は互いに非互換で、v3 と名乗ることは「厳しめ」ではなく
 * **別のライセンスだと主張すること**。実際 mysql-connector-python は
 * GPLv2 + FOSS 例外なのに GPL-3.0-only と答えていた。
 *
 * 族が分かれば義務も判定も決まる（GPL の v2/v3 はどちらも strong-copyleft）。
 * 決まらないのは版だけなので、版だけを言わない。engine は式として
 * 読めない単一の識別子を categorize に回すので、この値で判定は通る。
 */
const VERSIONLESS_CLASSIFIERS: Record<string, string> = {
  'GNU General Public License (GPL)': 'GPL',
  'GNU Library or Lesser General Public License (LGPL)': 'LGPL',
};

/**
 * 一意に版を決められない分類子。
 * "BSD License" は 2-Clause と 3-Clause のどちらかを区別しない。
 * この場合は自由記述の info.license の方が具体的なことがあるので先に見る。
 */
const AMBIGUOUS_CLASSIFIERS = new Set(['BSD License', ...Object.keys(VERSIONLESS_CLASSIFIERS)]);

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
  const specific: string[] = [];
  const ambiguous: string[] = [];
  for (const c of doc.info?.classifiers ?? []) {
    const tail = c.replace(/^License :: (OSI Approved :: )?/, '');
    const id = CLASSIFIER_TO_SPDX[tail] ?? VERSIONLESS_CLASSIFIERS[tail];
    if (!id) continue;
    (AMBIGUOUS_CLASSIFIERS.has(tail) ? ambiguous : specific).push(id);
  }

  const chosen = join(specific);
  if (chosen) return chosen;

  const free = fromFreeText(doc);
  if (free) return free;

  return join(ambiguous);
}

/**
 * 複数の分類子を 1 つの式にまとめる。
 *
 * **先に書かれたものを答えにしないこと。** PyPI は分類子を著者が書いた順に
 * 保つだけで、そこに優先度は無い。先勝ちにすると、同じ意味の 2 つの
 * パッケージが並び順だけで別の答えになり、しかも緩い方が先にあると
 * コピーレフトの義務が消える。
 *
 * 複数宣言はほぼ常に「どちらかを選べる」意味なので OR で繋ぐ。
 * policy 側が緩い方を選び、利用者には選択肢が両方見える。
 * 並べ替えるのは、答えを著者の記述順から切り離すため。
 */
function join(ids: string[]): string | null {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return null;
  return unique.join(' OR ');
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
