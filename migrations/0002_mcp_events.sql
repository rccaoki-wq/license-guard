-- MCP の利用計測。
--
-- プライバシー方針: パッケージ名とマニフェスト本文は保存しない。
-- マニフェストには社内限りのパッケージ名が含まれうるため、コンプライアンス
-- ツールとして預かるべきでない。判定の分布とクライアントの種類だけを記録する。

CREATE TABLE IF NOT EXISTS mcp_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event              TEXT NOT NULL,   -- 'initialize' | 'tool_call'
  tool               TEXT,
  ecosystem          TEXT,
  distribution_model TEXT,
  verdict            TEXT,
  client_name        TEXT,
  client_version     TEXT,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_events_created ON mcp_events (created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_events_event ON mcp_events (event, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_events_client ON mcp_events (client_name, created_at);
