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
 * 情報源が不変か（そのバージョン自身の宣言に基づくか）。
 *
 * `repo-license` は既定ブランチの現在の LICENSE を読んだもので、
 * 再ライセンスされればその日から答えが変わる。今は版が null の問いにしか
 * 使われず put も走らないが、**「版に紐づく事実」ではない点は同じ**なので
 * ここで先に不変から外しておく。後で経路が増えたときに、
 * 古い答えを恒久に返す形にはならない。
 */
function isImmutableSource(source: string): boolean {
  return source !== 'registry-latest' && source !== 'repo-license';
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

    if (!isImmutableSource(row.source)) {
      // 期限を判定できない行は使わない。古い可能性を無視するより再取得する方が安全
      if (typeof row.resolved_at !== 'number') return null;
      if (Date.now() - row.resolved_at > LATEST_FALLBACK_TTL_MS) return null;
    }

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
            if (!isImmutableSource(row.source)) {
              if (typeof row.resolved_at !== 'number') continue;
              if (Date.now() - row.resolved_at > LATEST_FALLBACK_TTL_MS) continue;
            }
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
