-- ページ到達の記録。
--
-- なぜ要るか。到達計測はトップページにしか入っていなかった。ビーコンは
-- レイアウトの任意 script として渡す作りで、渡しているのはトップだけ。
-- 検索向けに 874 枚のページを作っておきながら、そこへの着地は 1 件も
-- 記録されていなかった。「人間の到達 3 件」は正しくは「トップに来た 3 人」で、
-- 検索から本文ページに直接来た人は最初から見えていない。
--
-- クライアント側のビーコンではなくサーバ側で数えるのは、JS を実行しない
-- クローラーも数えたいため。索引されているかどうかはここでしか分からない。
--
-- 明細ではなく日次の集計で持つ。1 行 1 到達にすると、巡回ボットが
-- 毎日 874 ページを舐めるだけで行が積み上がる。知りたいのは
-- 「どのページに、どの種別が、どこから、何件来たか」であって個々の到達ではない。
--
-- **経路は生のまま入れない。** page には page-class.ts が返す分類しか入れず、
-- /pkg/* はパッケージ名を落として 'pkg' に潰す。何を調べたかは保存しない。
CREATE TABLE IF NOT EXISTS page_views (
  day         TEXT    NOT NULL,           -- YYYY-MM-DD (UTC)
  page        TEXT    NOT NULL,           -- classifyPath() の戻り値
  client_kind TEXT    NOT NULL,           -- bot | browser | unknown
  source      TEXT    NOT NULL,           -- direct | search | ai | social | other
  synthetic   INTEGER NOT NULL DEFAULT 0, -- 自分の検証トラフィック
  hits        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, page, client_kind, source, synthetic)
);

CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views (day);
