import { fetchJson } from './http';
import type { LicenseLookup } from './index';

interface NpmVersionDoc {
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
}

function normalizeLicenseField(doc: NpmVersionDoc): string | null {
  if (typeof doc.license === 'string' && doc.license.trim() !== '') {
    return doc.license.trim();
  }
  if (doc.license && typeof doc.license === 'object' && doc.license.type) {
    return doc.license.type;
  }
  if (Array.isArray(doc.licenses)) {
    const types = doc.licenses.map((l) => l.type).filter((t): t is string => !!t);
    if (types.length === 1) return types[0]!;
    if (types.length > 1) return `(${types.join(' OR ')})`;
  }
  return null;
}

/**
 * npm レジストリからライセンスを取得する。
 *
 * パッケージ全体の文書ではなくバージョン単位のエンドポイントを叩く。
 * 全体文書は全バージョンのメタデータを含み、typescript では 15MB を超えるため
 * Worker のタイムアウトと CPU 時間を使い切る。バージョン単位なら約 5KB。
 *
 * 固定版から採れない場合に最新版へ落とす理由は 2 つある。
 *
 * 1. マニフェストの "^5.6.0" は範囲でありバージョンではない。剥がした値が
 *    実際には未公開のことがある（TypeScript の 5.6 系は 5.6.2 が初出）。
 * 2. 2014 年頃より前のパッケージには license フィールドの慣習が無く、
 *    express@1.0.0 のような古い版は情報を持たない。ここで「不明」と返すと、
 *    誰もが MIT と知っているパッケージが警告対象になり信頼を失う。
 *
 * 落とした事実は fromLatest で呼び出し側に伝える。再ライセンスは実在する
 * （Grafana の Apache-2.0 から AGPL-3.0 など）ため、黙って最新版の結論を
 * 固定版の結論として出すことは許されない。
 */
export async function fetchNpmLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  const base = `https://registry.npmjs.org/${encodeURIComponent(name)}`;

  if (version !== null) {
    const pinned = await fetchJson<NpmVersionDoc>(
      `${base}/${encodeURIComponent(version)}`,
      fetchImpl,
    );
    const spdx = pinned ? normalizeLicenseField(pinned) : null;
    if (spdx !== null) return { spdx };
  }

  const latest = await fetchJson<NpmVersionDoc>(`${base}/latest`, fetchImpl);
  const spdx = latest ? normalizeLicenseField(latest) : null;

  if (spdx === null) return { spdx: null };
  return version === null ? { spdx } : { spdx, fromLatest: true };
}
