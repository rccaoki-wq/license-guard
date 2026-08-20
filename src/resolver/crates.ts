import { fetchJson } from './http';
import type { LicenseLookup } from './index';

/**
 * crates.io はリクエストに User-Agent を求めており、無いと拒否される
 * （API データアクセスポリシー違反として弾かれる）。誰が叩いているかを
 * 명示するため、連絡先を兼ねた URL を入れる。
 */
const USER_AGENT = 'licenseguard/1.0 (https://license-guard.rcc-aoki.workers.dev)';

interface VersionDoc {
  license?: string | null;
  num?: string;
}
interface CrateDoc {
  version?: VersionDoc;
  versions?: VersionDoc[];
  crate?: { max_stable_version?: string };
}

function withUserAgent(fetchImpl: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, {
      ...init,
      headers: { ...(init?.headers ?? {}), 'user-agent': USER_AGENT },
    })) as typeof fetch;
}

function clean(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/**
 * crates.io からライセンスを取得する。
 * ライセンスは SPDX 式で返る（"MIT OR Apache-2.0" など）。
 */
export async function fetchCratesLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  const f = withUserAgent(fetchImpl);
  const base = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;

  if (version !== null) {
    const doc = await fetchJson<CrateDoc>(`${base}/${encodeURIComponent(version)}`, f);
    const spdx = clean(doc?.version?.license);
    if (spdx !== null) return { spdx };
  }

  const doc = await fetchJson<CrateDoc>(base, f);
  if (doc === null) return { spdx: null };

  // versions は新しい順。安定版が示されていればそれを優先する
  const stable = doc.crate?.max_stable_version;
  const picked: VersionDoc | undefined =
    (stable ? doc.versions?.find((v) => v.num === stable) : undefined) ??
    doc.versions?.[0] ??
    doc.version;

  const spdx = clean(picked?.license);
  if (spdx === null) return { spdx: null };
  return version === null ? { spdx } : { spdx, fromLatest: true };
}
