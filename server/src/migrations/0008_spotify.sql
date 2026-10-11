-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0
-- Rebuild without renaming the old table: existing child FKs keep sources(id).
CREATE TABLE sources_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('local', 's3', 'qobuz', 'spotify')),
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  creds_encrypted BLOB,
  fetch_mode TEXT NOT NULL DEFAULT 'auto' CHECK (fetch_mode IN ('auto', 'direct', 'proxy')),
  cache_policy TEXT NOT NULL CHECK (cache_policy IN ('all', 'pin-only', 'none')),
  last_scanned_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO sources_new SELECT * FROM sources;
DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;
