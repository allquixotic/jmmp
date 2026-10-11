-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0
CREATE TABLE local_files (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_track_id TEXT NOT NULL,
  storage_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (source_id, source_track_id)
);

ALTER TABLE tracks ADD COLUMN server_available INTEGER NOT NULL DEFAULT 1;
UPDATE tracks SET server_available = 0 WHERE source_id IN (SELECT id FROM sources WHERE kind = 'local');
