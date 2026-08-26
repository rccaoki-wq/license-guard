import type { Dependency } from '../types';

export interface CachedLicense {
  spdx: string | null;
  source: string;
}

interface CacheRow {
  spdx: string | null;
  source: string;
  resolved_at: number | null;
}

/**
 * 最新版フォールバック結果の有効期限。
 *
 * 固定バージョンのライセンスは不変なので恒久にキャッシュしてよいが、
 * 'registry-latest' の結果は「最新リリース」という可変な情報源から得たものを
 * 固定バージョンのキーで保存している。再ライセンス（Grafana の Apache-2.0 から
 * AGPL-3.0 など）が起きた場合、期限を設けないと古い答えを永久に返し続け、
 * 添えている「最新リリースを反映しています」という注記が嘘になる。
 */
export const LATEST_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 劣後する情報源から得た答えの有効期限。
 *
 * **キャッシュの鍵に情報源が入っていない。**だから情報源の優先順位が効くのは
 * 最初に書き込む 1 回だけで、以降は誰が答えたかに関わらずその行が返り続ける。
 * 「固定版のライセンスは不変だから恒久で良い」は上流の事実については正しいが、
 * **どの情報源から読んだかを無視している**。
 *
 * Go は deps.dev を先に引き、答えなかったときだけ ClearlyDefined に落とす
 * （go.ts の測定: deps.dev 98〜100% / ClearlyDefined 38%）。落ちる理由の多くは
 * 大きい go.mod を流したときの上流の一時的な失敗で、**次に聞けば deps.dev が
 * 答える**。実測（2026-08-26、キャッシュ上の ClearlyDefined 由来 102 座標）では
 * 100 件を deps.dev が答え、うち 3 件は義務を**過少に**述べていた:
 *
 *     aws-sdk-go@v1.34.0      Apache-2.0 → Apache-2.0 AND BSD-3-Clause
 *     aws-sdk-go-v2@v1.11.0   Apache-2.0 → Apache-2.0 AND BSD-3-Clause
 *     microsoft-authentication-extensions-for-go/cache@v0.1.1
 *                             MIT        → BSD-3-Clause AND MIT
 *
 * 一時的に届かなかっただけの答えを恒久にすると、**緩い側の誤りが永久に残る**。
 * 期限を付けて、優先する情報源にもう一度機会を与える。
 */
export const FALLBACK_SOURCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 解決の規則を直した時刻。**ここより前に保存された答えは、直す前の規則で
 * 得たもの**なので使わない。
 *
 * 不変な情報源の行は恒久に残る。つまり規則を直しても、既に保存された誤答は
 * **永久に配り続ける**。2026-08-26、ClearlyDefined の記録から
 * `LicenseRef-scancode-*` を落とす修正を入れて配ったのに、実在の go.mod を
 * 流し直しても結果は 1 件も変わらなかった。誤答 22 行がキャッシュに載って
 * いたためで、手で DELETE するまで誰にも届かなかった。
 *
 * **直したことを覚えている人間に依存させない。**規則を直したらここに 1 行
 * 足す。該当する情報源の行だけが読み捨てられ、次の照会で新しい規則を通る。
 * 情報源ごとに分けてあるのは、関係の無い行まで捨てて上流を叩き直さないため。
 *
 * **期限とは別の話。**期限は「その答えが古くなったか」を見るが、epoch は
 * 「その答えが直す前の規則で得たものか」を見る。期限だけに任せると、直した
 * 誤答をその期限のあいだ配り続ける。誤りの修正は今届かなければ意味がないので
 * 両方掛ける。逆に、規則を直していない情報源にはここに何も置かない。
 */
export const RULE_EPOCH_MS: Readonly<Record<string, number>> = {
  // ClearlyDefined の記録から LicenseRef-scancode を落とすようにした。
  // 走査器の推定であって発行者の宣言ではない（clearlydefined.ts の usableDeclared）
  clearlydefined: Date.parse('2026-08-26T07:50:00Z'),
};

/** その行が、今の規則より前に保存されたものか */
function isPreRuleChange(source: string, resolvedAt: number | null): boolean {
  const epoch = RULE_EPOCH_MS[source];
  if (epoch === undefined) return false;
  // 時刻が無ければ前後を判定できない。判定できないものは信用しない
  return typeof resolvedAt !== 'number' || resolvedAt < epoch;
}

/** キャッシュ表のキー。エコシステムまたぎの取り違えを防ぐ */
export function cacheKey(ecosystem: string, name: string, version: string): string {
  return `${ecosystem}|${name}|${version}`;
}

/**
 * 一度の SQL に載せるパッケージ名の数。
 *
 * **D1 のバインドパラメータ上限は 1 クエリあたり 100 個**。
 * 超えるとクエリ自体が失敗する。エコシステムを 1 個使うので名前は 99 まで。
 * 余裕を見て 90 にしてある。
 *
 * 当初 200 にしていたため getMany が常に失敗し、catch に飲まれて
 * 「キャッシュが効いていない」ことに気づけなかった。上限は推測せず
 * 仕様を確認すること。
 */
const BATCH_SIZE = 90;

/**
 * その情報源の答えをどれだけの間そのまま使ってよいか。null は無期限。
 *
 * 期限が要る理由は 2 通りあり、どちらも「上流の事実」ではなく
 * **その行の出所**に由来する。
 */
function ttlFor(source: string): number | null {
  // 可変: そのバージョン自身の宣言ではない。`repo-license` は既定ブランチの
  // 現在の LICENSE を読んだもので、再ライセンスされればその日から答えが変わる。
  // 今は版が null の問いにしか使われず put も走らないが、「版に紐づく事実」で
  // ない点は同じなので先に外しておく
  if (source === 'registry-latest' || source === 'repo-license') return LATEST_FALLBACK_TTL_MS;
  // 劣後: 優先する情報源が一時的に届かなかっただけかもしれない。
  // ClearlyDefined は Go でも NuGet でも最後の手段で、先頭に置く経路が無い
  if (source === 'clearlydefined') return FALLBACK_SOURCE_TTL_MS;
  return null;
}

/** その行を今そのまま使ってよいか。get と getMany で判定を分けない */
function isStale(source: string, resolvedAt: number | null): boolean {
  if (isPreRuleChange(source, resolvedAt)) return true;

  const ttl = ttlFor(source);
  if (ttl === null) return false;
  // 期限を判定できない行は使わない。古い可能性を無視するより再取得する方が安全
  if (typeof resolvedAt !== 'number') return true;
  return Date.now() - resolvedAt > ttl;
}

/**
 * (ecosystem, package, version) をキーに全ユーザー共通でキャッシュする。
 * version が確定していない依存はキーが定まらないためキャッシュ対象外。
 */
export class LicenseCache {
  constructor(private readonly db: D1Database) {}

  async get(dep: Dependency): Promise<CachedLicense | null> {
    if (dep.version === null) return null;

    const row = await this.db
      .prepare(
        `SELECT spdx, source, resolved_at FROM license_cache
         WHERE ecosystem = ? AND package = ? AND version = ?`,
      )
      .bind(dep.ecosystem, dep.name, dep.version)
      .first<CacheRow>();

    if (!row) return null;

    if (isStale(row.source, row.resolved_at)) return null;

    return { spdx: row.spdx, source: row.source };
  }

  /**
   * 複数の依存をまとめて引く。
   *
   * ライセンスを内包しないロックファイル（pnpm-lock.yaml、yarn.lock、
   * go.sum など）では推移的依存が数百件になる。1 件ずつ問い合わせると
   * 往復が積み上がるうえ、上流照会が必要な件数を事前に見積もれない。
   *
   * キャッシュは最適化であり、失敗しても解決処理を止めない。
   */
  async getMany(deps: Dependency[]): Promise<Map<string, CachedLicense>> {
    const found = new Map<string, CachedLicense>();

    // エコシステムごとにまとめる
    const byEcosystem = new Map<string, Set<string>>();
    for (const d of deps) {
      if (d.version === null) continue;
      const names = byEcosystem.get(d.ecosystem) ?? new Set<string>();
      names.add(d.name);
      byEcosystem.set(d.ecosystem, names);
    }

    for (const [ecosystem, nameSet] of byEcosystem) {
      const names = [...nameSet];
      for (let i = 0; i < names.length; i += BATCH_SIZE) {
        const batch = names.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(',');
        try {
          const res = await this.db
            .prepare(
              `SELECT ecosystem, package, version, spdx, source, resolved_at
               FROM license_cache
               WHERE ecosystem = ? AND package IN (${placeholders})`,
            )
            .bind(ecosystem, ...batch)
            .all<CacheRow & { ecosystem: string; package: string; version: string }>();

          for (const row of res.results ?? []) {
            if (isStale(row.source, row.resolved_at)) continue;
            found.set(cacheKey(row.ecosystem, row.package, row.version), {
              spdx: row.spdx,
              source: row.source,
            });
          }
        } catch {
          // 引けなくても上流照会で解決できる
        }
      }
    }

    return found;
  }

  async put(dep: Dependency, spdx: string | null, source: string): Promise<void> {
    if (dep.version === null) return;

    await this.db
      .prepare(
        `INSERT INTO license_cache (ecosystem, package, version, spdx, source, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (ecosystem, package, version) DO UPDATE SET
           spdx = excluded.spdx,
           source = excluded.source,
           resolved_at = excluded.resolved_at`,
      )
      .bind(dep.ecosystem, dep.name, dep.version, spdx, source, Date.now())
      .run();
  }
}
