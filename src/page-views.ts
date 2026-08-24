/**
 * ページ到達の記録（サーバ側）。
 *
 * **クライアント側のビーコンでは足りない。** 到達計測はレイアウトの任意
 * script として渡す作りで、渡していたのはトップページだけだった。検索向けに
 * 874 枚のページを用意しながら、そこへの着地は 1 件も記録されていなかった。
 * さらに JS を実行しないクローラーは、どのみちビーコンでは数えられない。
 * 索引されているかどうかはここでしか分からない。
 *
 * 数え落としの範囲（実測で確かめてある）。`s-maxage=86400` を返している
 * ので当初はエッジのキャッシュで Worker に届かないことを疑ったが、同一 URL
 * への連続 5 回がすべて記録され、応答に `cf-cache-status` も付かなかった。
 * Cloudflare は Worker の応答を勝手にキャッシュせず、毎回実行している。
 *
 * 残る取りこぼしはブラウザ側の `max-age=3600` で、同じ人が 1 時間以内に
 * 同じページを開き直した分は届かない。**のべ回数は少なめに出る。**
 * 人数ではなく回数であることと合わせて、実数として扱わない。
 */
import { classifyPath, classifySource, isTrackablePath, type Source } from './page-class';
import { classifyClient } from './client-kind';

export type PageViewRow = {
  day: string;
  page: string;
  clientKind: string;
  source: Source;
  synthetic: 0 | 1;
};

/** UTC の YYYY-MM-DD。集計の日付境界を実行環境のタイムゾーンに依存させない */
export const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * 記録すべき到達かを決め、保存する行を組み立てる。
 * 記録しないものは null を返す（呼び出し側で分岐を書かせない）。
 */
export function buildPageView(
  req: { path: string; status: number; contentType: string | null },
  headers: { userAgent?: string | null; referer?: string | null; synthetic: boolean },
  selfHost: string,
  at: number,
): PageViewRow | null {
  // 404 や リダイレクトを到達に数えない。「来たが中身が無かった」は別の話
  if (req.status !== 200) return null;
  // HTML と Markdown のページだけ。JSON API は利用者の行動ではなく機械の呼び出し
  if (!/^(text\/html|text\/markdown)/i.test(req.contentType ?? '')) return null;
  if (!isTrackablePath(req.path)) return null;

  return {
    day: utcDay(at),
    page: classifyPath(req.path),
    // 生の User-Agent は保存しない。bot/browser/unknown の別だけ
    clientKind: classifyClient(headers.userAgent),
    source: classifySource(headers.referer, selfHost),
    synthetic: headers.synthetic ? 1 : 0,
  };
}

const UPSERT =
  'INSERT INTO page_views (day, page, client_kind, source, synthetic, hits) VALUES (?, ?, ?, ?, ?, 1) ' +
  'ON CONFLICT (day, page, client_kind, source, synthetic) DO UPDATE SET hits = hits + 1';

export async function recordPageView(db: D1Database, row: PageViewRow): Promise<void> {
  await db
    .prepare(UPSERT)
    .bind(row.day, row.page, row.clientKind, row.source, row.synthetic)
    .run();
}
