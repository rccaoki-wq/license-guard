/**
 * Go モジュールパスを ClearlyDefined の座標 (type/provider/namespace/name/revision)
 * に変換する。namespace 内のスラッシュはエンコードが必要。
 */
export function toGoCoordinates(modulePath: string, version: string): string {
  const parts = modulePath.split('/');
  const name = parts.pop() ?? modulePath;
  const namespace = parts.length > 0 ? encodeURIComponent(parts.join('/')) : '-';
  return `go/golang/${namespace}/${name}/${version}`;
}

interface ClearlyDefinedDoc {
  licensed?: { declared?: string };
}

export async function fetchGoLicense(
  modulePath: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (version === null) return null;

  const url = `https://api.clearlydefined.io/definitions/${toGoCoordinates(modulePath, version)}`;

  let doc: ClearlyDefinedDoc;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    doc = (await res.json()) as ClearlyDefinedDoc;
  } catch {
    return null;
  }

  const declared = doc.licensed?.declared?.trim();
  if (!declared || declared === 'NOASSERTION') return null;

  return declared;
}
