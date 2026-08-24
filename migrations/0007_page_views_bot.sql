-- 到達記録にクローラー名を足す。
--
-- 列の追加では済まない。bot は主キーの一部でなければならず（同じページに
-- GPTBot と Googlebot が来たら別の行になる必要がある）、SQLite は
-- ALTER TABLE で主キーを変えられないため、作り直して移す。
--
-- 既存行は名前が分からないので 'other' に寄せる。'none' ではない。
-- 'none' は「ボットではなかった」の意味で、既存のボット行に付けると
-- 人間の到達として読めてしまう。

CREATE TABLE page_views_v2 (
  day         TEXT    NOT NULL,           -- YYYY-MM-DD (UTC)
  page        TEXT    NOT NULL,           -- classifyPath() の戻り値
  client_kind TEXT    NOT NULL,           -- bot | browser | unknown
  bot         TEXT    NOT NULL,           -- classifyBot() の戻り値。人間は 'none'
  source      TEXT    NOT NULL,           -- direct | internal | search | ai | social | other
  synthetic   INTEGER NOT NULL DEFAULT 0,
  hits        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, page, client_kind, bot, source, synthetic)
);

INSERT INTO page_views_v2 (day, page, client_kind, bot, source, synthetic, hits)
SELECT day, page, client_kind,
       CASE WHEN client_kind = 'bot' THEN 'other' ELSE 'none' END,
       source, synthetic, hits
FROM page_views;

DROP TABLE page_views;

ALTER TABLE page_views_v2 RENAME TO page_views;

CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views (day);
CREATE INDEX IF NOT EXISTS idx_page_views_bot ON page_views (bot);
