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

/** 情報源が不変か（そのバージョン自身の宣言に基づくか） */
function isImmutableSource(source: string): boolean {
  return source !== 'registry-latest';
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
