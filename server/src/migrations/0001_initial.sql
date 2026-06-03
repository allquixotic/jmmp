-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id BLOB NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  nickname TEXT,
  aaguid BLOB,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER
);

CREATE TABLE bootstrap_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash BLOB NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  consumed_at INTEGER
);

CREATE TABLE webauthn_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_webauthn_challenges_created ON webauthn_challenges(created_at);

CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('local', 's3', 'qobuz')),
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  creds_encrypted BLOB,
  fetch_mode TEXT NOT NULL DEFAULT 'auto' CHECK (fetch_mode IN ('auto', 'direct', 'proxy')),
  cache_policy TEXT NOT NULL CHECK (cache_policy IN ('all', 'pin-only', 'none')),
  last_scanned_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_track_id TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  album_artist TEXT,
  album TEXT,
  year INTEGER,
  track_no INTEGER,
  disc_no INTEGER,
  duration_ms INTEGER,
  codec TEXT,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  file_size INTEGER,
  rg_track_db REAL,
  rg_album_db REAL,
  art_hash TEXT,
  mtime INTEGER,
  etag TEXT,
  indexed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (source_id, source_track_id)
);

CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_album ON tracks(album);
CREATE INDEX idx_tracks_album_artist ON tracks(album_artist);
CREATE INDEX idx_tracks_source ON tracks(source_id);

CREATE VIRTUAL TABLE tracks_fts USING fts5(
  title, artist, album_artist, album,
  content='tracks', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER tracks_fts_insert AFTER INSERT ON tracks BEGIN
  INSERT INTO tracks_fts(rowid, title, artist, album_artist, album)
  VALUES (new.id, new.title, new.artist, new.album_artist, new.album);
END;

CREATE TRIGGER tracks_fts_delete AFTER DELETE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album_artist, album)
  VALUES ('delete', old.id, old.title, old.artist, old.album_artist, old.album);
END;

CREATE TRIGGER tracks_fts_update AFTER UPDATE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album_artist, album)
  VALUES ('delete', old.id, old.title, old.artist, old.album_artist, old.album);
  INSERT INTO tracks_fts(rowid, title, artist, album_artist, album)
  VALUES (new.id, new.title, new.artist, new.album_artist, new.album);
END;

CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE queue_entries (
  position INTEGER PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  played_to_completion INTEGER NOT NULL DEFAULT 0,
  device_id TEXT
);

CREATE INDEX idx_history_played_at ON history(played_at DESC);

CREATE TABLE session_devices (
  id TEXT PRIMARY KEY,
  jwt_jti TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_heartbeat_at INTEGER NOT NULL DEFAULT (unixepoch()),
  is_player INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE qobuz_query_cache (
  query_hash TEXT PRIMARY KEY,
  results_json TEXT NOT NULL,
  cached_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE qobuz_entities (
  qobuz_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('track', 'album', 'artist')),
  data_json TEXT NOT NULL,
  cached_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (kind, qobuz_id)
);
