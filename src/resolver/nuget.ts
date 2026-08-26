import { fetchJson, fetchTextHead } from './http';
import { CLEARLYDEFINED_TIMEOUT_MS, usableDeclared } from './clearlydefined';
import type { LicenseLookup } from './index';

/**
 * NuGet は**正規化した版**でしか引けない。
 *
 * 実測で、上位 400 パッケージのうち 13 件が 404 になった。全部こちらの
 * 落ち度で、`8.4.0+build.694` のようにビルドメタデータが付いた版を
 * そのまま URL に入れていた。13/13 が正規化すれば索引に載っていた。
 * **上流の欠落に見えて、実際は自分の座標の作り方の問題だった。**
 *
 * 規則（NuGet のバージョン正規化）:
 * - ビルドメタデータ（`+` 以降）を落とす
 * - 各部の先頭の 0 を落とす（`1.02.3` → `1.2.3`）
 * - 4 つ目が 0 なら落とす（`1.0.0.0` → `1.0.0`）
 * - 2 つしかなければ 0 で埋める（`4.5` → `4.5.0`）
 * - 小文字にする（プレリリース識別子が大文字のことがある）
 */
export function normalizeNugetVersion(raw: string): string {
  const s = (raw.split('+')[0] ?? '').trim().toLowerCase();
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(-.*)?$/.exec(s);
  if (m === null) return s;

  const [, a, b, c, d, pre] = m;
  const core = [Number(a), Number(b), Number(c ?? 0)].join('.');
  const withRevision = d !== undefined && Number(d) !== 0 ? `${core}.${Number(d)}` : core;
  return withRevision + (pre ?? '');
}

interface ClearlyDefinedDoc {
  licensed?: { declared?: string };
}

async function fromClearlyDefined(
  name: string,
  version: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const doc = await fetchJson<ClearlyDefinedDoc>(
    `https://api.clearlydefined.io/definitions/nuget/nuget/-/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    fetchImpl,
    CLEARLYDEFINED_TIMEOUT_MS,
  );
  return usableDeclared(doc?.licensed?.declared);
}

/** nuspec は小さい。README を丸ごと抱えることはないが、上限は掛けておく */
const NUSPEC_MAX_BYTES = 64 * 1024;

interface NuspecLicense {
  /** `<license type="expression">` の中身 */
  expression: string | null;
  /** `<license type="file">` が書かれていた（本文を同梱している） */
  isFile: boolean;
}

export function readNuspecLicense(xml: string): NuspecLicense {
  const el = /<license\s([^>]*)>([^<]*)<\/license\s*>/i.exec(xml);
  const type = el === null ? null : /\btype\s*=\s*"([^"]*)"/i.exec(el[1] ?? '')?.[1]?.toLowerCase();

  if (type === 'expression') {
    const v = (el?.[2] ?? '').trim();
    if (v !== '') return { expression: v, isFile: false };
  }

  // 2019 年より前は式を URL に埋め込んでいた。`licenses.nuget.org` の
  // パスが式そのものなので、これは推測ではなく読み取り
  const url = /<licenseUrl>\s*https?:\/\/licenses\.nuget\.org\/([^<\s]+)\s*<\/licenseUrl>/i.exec(
    xml,
  );
  if (url?.[1]) {
    try {
      const v = decodeURIComponent(url[1]).trim();
      if (v !== '') return { expression: v, isFile: type === 'file' };
    } catch {
      // 壊れたエスケープは無視して下へ
    }
  }

  return { expression: null, isFile: type === 'file' };
}

interface FlatIndex {
  versions?: string[];
}

/** 版を指定されなかったときに使う、索引上の最も新しい版 */
async function latestVersion(lowerId: string, fetchImpl: typeof fetch): Promise<string | null> {
  const doc = await fetchJson<FlatIndex>(
    `https://api.nuget.org/v3-flatcontainer/${lowerId}/index.json`,
    fetchImpl,
  );
  const versions = doc?.versions ?? [];
  if (versions.length === 0) return null;

  // 索引は昇順。プレリリースを避けたいが、それしか無ければ使う
  const stable = versions.filter((v) => !v.includes('-'));
  return (stable.length > 0 ? stable : versions).at(-1) ?? null;
}

async function nuspecFor(
  lowerId: string,
  version: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  return fetchTextHead(
    `https://api.nuget.org/v3-flatcontainer/${lowerId}/${version}/${lowerId}.nuspec`,
    NUSPEC_MAX_BYTES,
    fetchImpl,
  );
}

/**
 * nuget.org からライセンスを取得する。
 *
 * **deps.dev は使わない。** NuGet では欠損した座標すべてに
 * `non-standard` という中身のない値を返すことを実測で確認した
 * （63/63）。Go で頼っているのと同じ相手でも、系ごとに持っている
 * ものが違う。「どこから読んだか」ではなく「何が書いてあるか」で
 * 決める。
 *
 * 出典の優先順:
 * 1. nuspec の `<license type="expression">` —— 一次情報・版そのもの
 * 2. `licenses.nuget.org/{式}` の URL —— 式が URL に入っている旧形式
 * 3. ClearlyDefined —— 同梱本文を読んだキュレーション結果
 *
 * どれも無く、かつ `<license type="file">` が書かれていた場合は
 * `license-file` として返す。**「読めなかった」ではなく「読めない形で
 * 宣言されている」**——利用者が実物を開けば分かる、という別の事実。
 */
export async function fetchNugetLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenseLookup> {
  const lowerId = name.toLowerCase();
  const asked = version === null ? null : normalizeNugetVersion(version);

  const target = asked ?? (await latestVersion(lowerId, fetchImpl));
  if (target === null) return { spdx: null };

  const xml = await nuspecFor(lowerId, target, fetchImpl);

  // 版を指定されていて、その版の nuspec が無いなら最新へ落とす。
  // 落ちたことは fromLatest で必ず伝える
  if (xml === null) {
    if (asked === null) return { spdx: null };
    const latest = await latestVersion(lowerId, fetchImpl);
    if (latest === null || latest === target) return { spdx: null };

    const fallback = await nuspecFor(lowerId, latest, fetchImpl);
    if (fallback === null) return { spdx: null };

    const found = readNuspecLicense(fallback);
    if (found.expression !== null) return { spdx: found.expression, fromLatest: true };

    const curated = await fromClearlyDefined(name, latest, fetchImpl);
    if (curated !== null) {
      return { spdx: curated, fromLatest: true, source: 'clearlydefined' };
    }
    return found.isFile ? { spdx: null, source: 'license-file' } : { spdx: null };
  }

  const found = readNuspecLicense(xml);
  if (found.expression !== null) {
    // 版を指定しない問いに最新を答えるのは**落ちた**のではなく正しい答え
    return asked === null || asked === target
      ? { spdx: found.expression }
      : { spdx: found.expression, fromLatest: true };
  }

  const curated = await fromClearlyDefined(name, target, fetchImpl);
  if (curated !== null) return { spdx: curated, source: 'clearlydefined' };

  return found.isFile ? { spdx: null, source: 'license-file' } : { spdx: null };
}
