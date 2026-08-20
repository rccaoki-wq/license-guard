-- 計測の帰属。
--
-- 問題: ステートレス Streamable HTTP では clientInfo が initialize にしか来ない。
-- そのため tool_call 行の client_name は 100% NULL になっていた。Phase 0 の
-- 検証指標は「継続呼び出し数」なのに、呼び出しが誰のものか原理的に分からず、
-- **自分のテスト・巡回クローラー・実利用者が同じ NULL に落ちていた**。
--
-- 対処は2つ。
--
-- 1. session_id — 仕様が定める Mcp-Session-Id を発行し、全イベントに記録する。
--    initialize 行が client_name を持ち、tool_call 行が同じ session_id を持つので、
--    集計時に結合すれば帰属が付く。リクエストごとの追加読み取りは発生しない。
--
-- 2. synthetic — 自分の E2E が送る印。1 なら集計から外す。自己申告だが、
--    他人が付けても自分の行が除外されるだけで、汚染には使えない。
--
-- session_id は不透明なランダム値であり、パッケージ名・マニフェスト本文・
-- IP アドレスを保存しない方針（0002 参照）は変えていない。
--
-- 既存行は NULL のまま残す。0 を既定値にすると「実利用だった」と嘘をつくことになる。
-- NULL は「計測が入る前の行であり帰属不能」を意味する。

ALTER TABLE mcp_events ADD COLUMN session_id TEXT;
ALTER TABLE mcp_events ADD COLUMN synthetic INTEGER;

ALTER TABLE events ADD COLUMN synthetic INTEGER;

ALTER TABLE interest_signals ADD COLUMN synthetic INTEGER;

CREATE INDEX IF NOT EXISTS idx_mcp_events_session ON mcp_events (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_events_synthetic ON mcp_events (synthetic, created_at);
