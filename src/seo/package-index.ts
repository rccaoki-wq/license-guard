import { ECOSYSTEMS, type Ecosystem } from '../types';
import type { SitemapPackage } from './sitemap';

/**
 * 公開するパッケージページの索引。
 *
 * **なぜ license_cache と別の表なのか。** あちらは
 * (ecosystem, package, version) を鍵にした解決の控えで、版が定まらない依存は
 * 鍵が作れないため書けない（`LicenseCache.put` は version が null なら何も
 * しない）。一方 `/pkg` のページは版を持たない――「lodash は商用で安全か」に
 * 版は要らない――ので、あの表には一行も入らなかった。
 *
 * 結果、公開できたのは「誰かが版付きのロックファイルを貼った」パッケージ
 * だけで、人が実際に検索するパッケージを用意しようと要求しても載らなかった。
 * 8 ページしか無く、うち 3 つが誰も検索しない crate だったのはこのため。
 *
 * **時刻を持たないこと。** cache 側の resolved_at は registry-latest の期限
 * 判定に要るが、索引には要らない。到達が少ないうちは「パッケージごとの時刻」は
 * 「誰がいつ何を調べたか」とほぼ同じで、「誰が尋ねたかは記録しない」という
 * トップページの約束を破る。
 */

/**
 * 解決できたパッケージを索引に載せる。
 *
 * **spdx が null なら書かないこと。** 解決できない名前は社内パッケージの形を
 * している。「解決できなかった名前は書かない」はトップページに書いてある
 * 公開の約束で、表の spdx を NOT NULL にしてあるのも同じ理由。
 *
 * 索引は付随的な仕事なので、失敗してもページの応答は止めない。
 */
export async function recordPackagePage(
  db: D1Database,
  ecosystem: Ecosystem,
  name: string,
  spdx: string | null,
): Promise<void> {
  if (spdx === null) return;

  try {
    await db
      .prepare(
        `INSERT INTO package_index (ecosystem, package, spdx)
         VALUES (?, ?, ?)
         ON CONFLICT (ecosystem, package) DO UPDATE SET spdx = excluded.spdx`,
      )
      .bind(ecosystem, name, spdx)
      .run();
  } catch {
    // 索引に載らないだけで、ページ自体は毎回その場で解決して返せる
  }
}

/**
 * 公開しうるパッケージを集める。sitemap と `/packages` の**両方がこれを使う**。
 *
 * 別々に問い合わせると、提出しているのに一覧から辿れないページや、一覧に
 * あるのに提出していないページが静かにできる。取得元を 1 本にする。
 * 絞り込み（結論が配布モデルで変わるか）は表示側の述語に任せる。
 *
 * 二つの表を UNION するのは、版付きで走査されたパッケージと、版を伴わずに
 * 要求されて解決したパッケージの**どちらも**公開対象だから。片方だけを見ると
 * 一方が丸ごと落ちる。
 */
export async function listPackageIndex(db: D1Database): Promise<SitemapPackage[]> {
  try {
    const rows = await db
      .prepare(
        `SELECT ecosystem, package, spdx FROM package_index
         UNION
         SELECT DISTINCT ecosystem, package, spdx FROM license_cache WHERE spdx IS NOT NULL
         ORDER BY package LIMIT 45000`,
      )
      .all<{ ecosystem: string; package: string; spdx: string }>();

    return (rows.results ?? [])
      .filter((r): r is { ecosystem: Ecosystem; package: string; spdx: string } =>
        // 表に直接入った値まで信用すると、経路を作れないリンクを sitemap に出す
        ECOSYSTEMS.includes(r.ecosystem as Ecosystem),
      )
      .map((r) => ({ ecosystem: r.ecosystem, name: r.package, spdx: r.spdx }));
  } catch {
    // DB 障害時も静的ページだけで応答を返す
    return [];
  }
}
