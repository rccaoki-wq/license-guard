import { fetchJson } from './http';
import { fetchLatestGoVersion } from './goproxy';

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

/**
 * ClearlyDefined から Go モジュールのライセンスを取得する。
 *
 * 未ハーベストの座標は初回要求時にその場でハーベストされるため応答が
 * 極めて遅くなる場合がある。fetchJson のタイムアウトにより null に落ち、
 * 次回以降はキャッシュ済みの定義が高速に返る。
 */
export async function fetchGoLicense(
  modulePath: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  // ClearlyDefined の座標はリビジョン必須。未指定ならプロキシから最新版を引く。
  const revision = version ?? (await fetchLatestGoVersion(modulePath, fetchImpl));
  if (revision === null) return null;

  const url = `https://api.clearlydefined.io/definitions/${toGoCoordinates(modulePath, revision)}`;

  const doc = await fetchJson<ClearlyDefinedDoc>(url, fetchImpl);
  if (doc === null) return null;

  const declared = doc.licensed?.declared?.trim();
  if (!declared || declared === 'NOASSERTION') return null;

  return declared;
}
