-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE playlist_tracks
ADD COLUMN source_managed INTEGER NOT NULL DEFAULT 0;

UPDATE playlist_tracks
SET source_managed = 1
WHERE EXISTS (
  SELECT 1
  FROM source_playlists sp
  JOIN tracks t ON t.id = playlist_tracks.track_id
  WHERE sp.playlist_id = playlist_tracks.playlist_id
  AND t.source_id = sp.source_id
);
