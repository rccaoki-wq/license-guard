import type { Dependency } from '../types';

export interface CachedLicense {
  spdx: string | null;
  source: string;
}

/**
 * (ecosystem, package, version) に対するライセンスは不変であるため、
 * 全ユーザー共通でキャッシュする。version が確定していない依存はキーが
 * 定まらないためキャッシュ対象外とする。
 */
export class LicenseCache {
  constructor(private readonly db: D1Database) {}

  async get(dep: Dependency): Promise<CachedLicense | null> {
    if (dep.version === null) return null;

    const row = await this.db
      .prepare(
        'SELECT spdx, source FROM license_cache WHERE ecosystem = ? AND package = ? AND version = ?',
      )
      .bind(dep.ecosystem, dep.name, dep.version)
      .first<CachedLicense>();

    return row ?? null;
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
