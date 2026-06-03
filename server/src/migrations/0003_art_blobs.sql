-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE art_blobs (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
