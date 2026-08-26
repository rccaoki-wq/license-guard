import parse from 'spdx-expression-parse';
import { normalizeExpressionOperands, normalizeLicenseString } from '../policy/normalize';
import { isSafePackageName } from './name-safety';
import { parsePurl, purlType } from './purl';
import type { Dependency, Scope } from '../types';

/**
 * SBOM（CycloneDX / SPDX）の読み取り。
 *
 * ロックファイルとの違いは二つある。
 *
 * 一つ目——**1 文書に複数のエコシステムが同居する。** npm と PyPI と Maven が
 * 並ぶのが普通なので、依存ごとの系は依存自身から読まなければならない。
 *
 * 二つ目——**ライセンスが既に書いてある。** レジストリ照会が要らないので
 * 上限にも時間にも当たらず全件即答できる。ただしそれは*この文書を作った
 * 人の主張*であって、レジストリから今読み直した値ではない。古ければ古い
 * ままの答えが返る。出所を `lockfile` と同じ顔で出してはいけない。
 */

export interface SbomParse {
  dependencies: Dependency[];
  /**
   * 対応していない purl type ごとの件数（`maven` → 40 など）。
   *
   * **落としたことを黙らない**ために持つ。Java の利用者が Maven 中心の
   * SBOM を貼ったとき、黙って除くと「依存 0 件」または「npm だけ 3 件」と
   * 返り、検査が済んだ顔で何も見ていないことになる。
   */
  skipped: Map<string, number>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * 書いてあるライセンス表記を、そのまま判定に使ってよいかを決める。
 *
 * 使えないと判断したものは `undefined` を返し、**通常どおりレジストリを
 * 引かせる**。ここで無理に通すと、引けば分かったはずの依存に「判定不能」
 * が付く。捨てるのではなく、経路を戻すだけ。
 *
 * 弾くもの:
 * - `NOASSERTION` / `NONE`——SPDX で「主張しない」と明示された値。
 *   意味を持つ宣言ではないので、宣言として扱えば嘘になる
 * - `LicenseRef-*`——文書内ローカルの参照。SPDX 識別子ではないし、
 *   `LicenseRef-scancode-*` の類は走査器の推定であって発行者の宣言ではない
 * - 式として読めない自由文（"See LICENSE file", "Commercial"）
 */
export function usableLicense(raw: unknown): string | undefined {
  const value = str(raw);
  if (value === null) return undefined;
  if (/^(NOASSERTION|NONE)$/i.test(value)) return undefined;
  if (/LicenseRef-/i.test(value)) return undefined;

  // 綴りだけを SPDX に寄せる。版を補う正規化はここでは起きない
  const normalized = normalizeExpressionOperands(normalizeLicenseString(value));
  try {
    parse(normalized);
  } catch {
    return undefined;
  }
  return normalized;
}

/**
 * CycloneDX の `scope`。既定は `required`（spec）。
 *
 * `excluded` を dev に寄せない。dev に落とすと判定は allowed になり、
 * 理由文は「dev dependency なので出荷物に入らない」と書く。**文書は
 * そんなことを言っていない**——「成果物から除いた」と言っただけで、
 * 開発専用だとは書いていないし、こちらに確かめる手段も無い。
 * 出荷されるスコープのまま評価して、慎重な側で外す。
 */
const CDX_SCOPE: Record<string, Scope> = {
  required: 'runtime',
  optional: 'optional',
  excluded: 'optional',
};

// ── CycloneDX ──────────────────────────────────────────────────────

export function isCycloneDx(doc: unknown): boolean {
  return isRecord(doc) && str(doc['bomFormat'])?.toLowerCase() === 'cyclonedx';
}

/** CycloneDX の licenses[] からライセンス式を取り出す */
function cdxLicense(licenses: unknown): string | undefined {
  if (!Array.isArray(licenses)) return undefined;

  const found: string[] = [];
  for (const entry of licenses) {
    if (!isRecord(entry)) continue;

    // `expression` は SPDX 式そのもの。最も精確なので単独で採る
    const expression = usableLicense(entry['expression']);
    if (expression !== undefined) return expression;

    const license = entry['license'];
    if (!isRecord(license)) continue;
    // `id` は SPDX 識別子。`name` は自由文なので、SPDX として読めた場合だけ
    const one = usableLicense(license['id']) ?? usableLicense(license['name']);
    if (one !== undefined) found.push(one);
  }

  if (found.length === 0) return undefined;
  if (found.length === 1) return found[0]!;

  // 複数並んでいるとき、CycloneDX は AND か OR かを定めていない（だから
  // 後から `expression` が足された）。**AND に倒す。** OR と読めば
  // 一番緩い一つだけを守ればよいことになり、実際には課される義務を
  // 見落とす。多い側の義務を示して外れる方が損害が小さい
  return found.map((x) => (/[\s()]/.test(x) ? `(${x})` : x)).join(' AND ');
}

/** components は入れ子になりうる（component の中に component） */
function flattenComponents(list: unknown, out: Record<string, unknown>[]): void {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!isRecord(c)) continue;
    out.push(c);
    flattenComponents(c['components'], out);
  }
}

export function parseCycloneDx(doc: unknown): SbomParse {
  const dependencies: Dependency[] = [];
  const skipped = new Map<string, number>();
  if (!isRecord(doc)) return { dependencies, skipped };

  const components: Record<string, unknown>[] = [];
  flattenComponents(doc['components'], components);

  // `metadata.component` は SBOM の**対象**であって依存ではない。
  // 一部の生成器は components にも重ねて入れるので、purl で除く
  const metadata = doc['metadata'];
  const subject =
    isRecord(metadata) && isRecord(metadata['component'])
      ? str(metadata['component']['purl'])
      : null;

  for (const c of components) {
    const purl = str(c['purl']);
    if (purl === null) {
      // purl が無ければ、どのレジストリの何なのかを決める根拠が無い。
      // 名前と版だけで npm だと決めつければ、存在しない座標を引く
      bump(skipped, 'no package URL');
      continue;
    }
    if (subject !== null && purl === subject) continue;

    const coords = parsePurl(purl);
    if (coords === null) {
      bump(skipped, purlType(purl) ?? 'unrecognized package URL');
      continue;
    }
    if (!isSafePackageName(coords.name)) continue;

    dependencies.push({
      ecosystem: coords.ecosystem,
      name: coords.name,
      version: coords.version ?? str(c['version']),
      scope: CDX_SCOPE[str(c['scope'])?.toLowerCase() ?? 'required'] ?? 'runtime',
      origin: 'registry',
      declaredLicense: cdxLicense(c['licenses']),
      declaredFrom: 'sbom',
    });
  }

  return { dependencies: dedupe(dependencies), skipped };
}

// ── SPDX (JSON) ────────────────────────────────────────────────────

export function isSpdxJson(doc: unknown): boolean {
  return isRecord(doc) && /^SPDX-\d/i.test(str(doc['spdxVersion']) ?? '');
}

/** externalRefs から purl を取り出す */
function spdxPurl(refs: unknown): string | null {
  if (!Array.isArray(refs)) return null;
  for (const ref of refs) {
    if (!isRecord(ref)) continue;
    if (str(ref['referenceType'])?.toLowerCase() !== 'purl') continue;
    const locator = str(ref['referenceLocator']);
    if (locator !== null) return locator;
  }
  return null;
}

export function parseSpdxJson(doc: unknown): SbomParse {
  const dependencies: Dependency[] = [];
  const skipped = new Map<string, number>();
  if (!isRecord(doc)) return { dependencies, skipped };

  const packages = doc['packages'];
  if (!Array.isArray(packages)) return { dependencies, skipped };

  // 文書が「これについて書いた」と名指しした対象は依存ではない。
  // 2.2 までは documentDescribes、2.3 以降は DESCRIBES 関係で表す
  const described = new Set<string>();
  const describes = doc['documentDescribes'];
  if (Array.isArray(describes)) {
    for (const id of describes) {
      const s = str(id);
      if (s !== null) described.add(s);
    }
  }
  const relationships = doc['relationships'];
  if (Array.isArray(relationships)) {
    for (const r of relationships) {
      if (!isRecord(r)) continue;
      if (str(r['relationshipType'])?.toUpperCase() !== 'DESCRIBES') continue;
      const target = str(r['relatedSpdxElement']);
      if (target !== null) described.add(target);
    }
  }

  for (const p of packages) {
    if (!isRecord(p)) continue;
    const id = str(p['SPDXID']);
    if (id !== null && described.has(id)) continue;

    const purl = spdxPurl(p['externalRefs']);
    if (purl === null) {
      bump(skipped, 'no package URL');
      continue;
    }

    const coords = parsePurl(purl);
    if (coords === null) {
      bump(skipped, purlType(purl) ?? 'unrecognized package URL');
      continue;
    }
    if (!isSafePackageName(coords.name)) continue;

    // `licenseConcluded` はこの文書の作成者が出した結論、`licenseDeclared` は
    // パッケージ自身の宣言。結論の方が新しい情報を含みうるので先に見るが、
    // 実際には NOASSERTION であることが多く、その場合は宣言に落ちる
    const license = usableLicense(p['licenseConcluded']) ?? usableLicense(p['licenseDeclared']);

    dependencies.push({
      ecosystem: coords.ecosystem,
      name: coords.name,
      version: coords.version ?? str(p['versionInfo']),
      scope: 'runtime',
      origin: 'registry',
      declaredLicense: license,
      declaredFrom: 'sbom',
    });
  }

  return { dependencies: dedupe(dependencies), skipped };
}

// ── 共通 ───────────────────────────────────────────────────────────

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * 同じ座標が複数回現れることがある（同じライブラリが複数の成果物に
 * 入っている SBOM）。**先に現れた方を残す。** 後勝ちにすると、
 * ライセンスが書いてある成分を、書いていない同名の成分が上書きしうる。
 */
function dedupe(dependencies: Dependency[]): Dependency[] {
  const seen = new Set<string>();
  return dependencies.filter((dep) => {
    const key = `${dep.ecosystem}|${dep.name}|${dep.version ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
