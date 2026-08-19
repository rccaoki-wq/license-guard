interface NpmVersionDoc {
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
}

interface NpmPackageDoc {
  'dist-tags'?: { latest?: string };
  versions?: Record<string, NpmVersionDoc>;
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
 * version が null の場合は dist-tags.latest を用いる。
 */
export async function fetchNpmLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;

  let doc: NpmPackageDoc;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    doc = (await res.json()) as NpmPackageDoc;
  } catch {
    return null;
  }

  const target = version ?? doc['dist-tags']?.latest;
  if (!target) return null;

  const versionDoc = doc.versions?.[target];
  if (!versionDoc) return null;

  return normalizeLicenseField(versionDoc);
}
