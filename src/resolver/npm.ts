import { fetchJson } from './http';

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
 * 全体文書は全バージョンのメタデータを含み、typescript では 15MB を超えるため、
 * Worker のタイムアウトと CPU 時間を使い切る。バージョン単位なら約 5KB。
 *
 * マニフェストの "^5.6.0" は範囲であってバージョンではない。剥がした値が
 * 実際には公開されていないことがある（TypeScript の 5.6 系は 5.6.2 が初出）ため、
 * 404 の場合は latest に落とす。存在する場合に latest を引かないのは、
 * 再ライセンス（Grafana の Apache-2.0 から AGPL-3.0 など）があるため。
 */
export async function fetchNpmLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const base = `https://registry.npmjs.org/${encodeURIComponent(name)}`;

  let doc: NpmVersionDoc | null = null;
  if (version !== null) {
    doc = await fetchJson<NpmVersionDoc>(`${base}/${encodeURIComponent(version)}`, fetchImpl);
  }
  if (doc === null) {
    doc = await fetchJson<NpmVersionDoc>(`${base}/latest`, fetchImpl);
  }
  if (doc === null) return null;

  return normalizeLicenseField(doc);
}
