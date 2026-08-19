-- LicenseGuard Phase 0 初期スキーマ

CREATE TABLE IF NOT EXISTS license_cache (
  ecosystem   TEXT NOT NULL,
  package     TEXT NOT NULL,
  version     TEXT NOT NULL,
  spdx        TEXT,
  source      TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  PRIMARY KEY (ecosystem, package, version)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload    TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_created ON events (name, created_at);
