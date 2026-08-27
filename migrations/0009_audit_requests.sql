-- 有料監査の依頼受付。**interest_signals とは別の表。**
--
-- interest_signals は「作ったら知らせて」という関心表明で、鍵はメールだけ。
-- 同じ人が何度出しても 1 行に畳んでよく、内容が上書きされて構わない。
-- 依頼はそうではない。**同じ会社が別の案件で 2 回出すことがあり、
-- 畳むと後から来た方が先の依頼を消す。**取りこぼしが売上の取りこぼしに
-- そのまま化けるので、鍵を独立させて 1 依頼 1 行にする。
--
-- **マニフェストの中身は受け取らない。**依頼段階で必要なのは規模と配布形態
-- だけで、依存の一覧はやり取りが始まってから直接もらえばよい。「貼った
-- ものは保存しない」という公開の約束（/ の説明文）が、受付の口から
-- 崩れることのないようにする。
--
-- 会社名を任意にしてあるのは、名乗る前に問い合わせたい人を弾かないため。
-- 弾いた分は「連絡先が取れなかった」ではなく「そもそも来なかった」に
-- なるので、後から取り返せない。
CREATE TABLE IF NOT EXISTS audit_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL,
  company            TEXT,
  -- 配布形態。この製品が値段をつけている唯一の軸なので、依頼時点で聞く
  distribution_model TEXT,
  -- 規模の自己申告（リポジトリ数・言語など）。見積もりの根拠になる
  scope              TEXT,
  note               TEXT,
  -- 自分の E2E を実利用者と混ぜない。混ぜると 0 件を 1 件と読み違える
  synthetic          INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL
);

-- 同じ相手からの再依頼をまとめて見るため。鍵ではないので畳まれない
CREATE INDEX IF NOT EXISTS audit_requests_email ON audit_requests (email);
