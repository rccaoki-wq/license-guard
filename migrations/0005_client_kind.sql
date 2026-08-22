-- 到達したのが人かボットかを区別する。
--
-- 問題: 到達を測れるようにしたら 8 件記録されたが、全員が何もせず帰った。
-- 「入口が悪くて離脱した人間」なのか「JS を実行しただけのクローラー」なのかで
-- 打ち手が正反対になるのに、区別する手段が無かった。
-- 計測を足すたびに同じ形の穴が出ている（0004 と同じ轍）。
--
-- 保存するのは **種別だけ**。生の User-Agent は保存しない。
-- IP もパッケージ名もマニフェスト本文も保存しない方針は変えていない。
-- 'bot' / 'browser' / 'unknown' の 3 値で、個人を識別する力を持たない。
--
-- 既存行は NULL のまま。0 や 'unknown' を既定にすると「判定した結果
-- 不明だった」と区別がつかなくなる。NULL は「計測前の行」を意味する。

ALTER TABLE events ADD COLUMN client_kind TEXT;

CREATE INDEX IF NOT EXISTS idx_events_kind ON events (client_kind, created_at);
