-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE source_playlists (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_playlist_id TEXT NOT NULL,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (source_id, source_playlist_id),
  UNIQUE (playlist_id)
);

CREATE INDEX idx_source_playlists_playlist ON source_playlists(playlist_id);
