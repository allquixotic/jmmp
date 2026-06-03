// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../db.ts";
import {
  rebuildSourcePlaylistTracks,
  replacePlaylistTracks,
} from "../playlist-tracks.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "jmmp-test-"));
}

describe("source playlist overlays", () => {
  test("source-order playlists follow source rows and append local additions", () => {
    const db = initDb(freshDir());
    seedImportedPlaylist(db);

    rebuildSourcePlaylistTracks(db, 1, [2, 3]);

    const rows = db
      .query<{ track_id: number; source_managed: number }, []>(
        `SELECT track_id, source_managed FROM playlist_tracks
         WHERE playlist_id = 1 ORDER BY position`
      )
      .all();
    expect(rows).toEqual([
      { track_id: 2, source_managed: 1 },
      { track_id: 3, source_managed: 1 },
      { track_id: 4, source_managed: 0 },
    ]);
    db.close();
  });

  test("local-order playlists preserve cross-source position and merge new source rows", () => {
    const db = initDb(freshDir());
    seedImportedPlaylist(db);
    db.run("UPDATE playlists SET local_order = 1 WHERE id = 1");

    rebuildSourcePlaylistTracks(db, 1, [2, 3]);

    const rows = db
      .query<{ track_id: number; source_managed: number }, []>(
        `SELECT track_id, source_managed FROM playlist_tracks
         WHERE playlist_id = 1 ORDER BY position`
      )
      .all();
    expect(rows).toEqual([
      { track_id: 4, source_managed: 0 },
      { track_id: 2, source_managed: 1 },
      { track_id: 3, source_managed: 1 },
    ]);
    db.close();
  });

  test("manual replacement keeps imported-source rows source-managed", () => {
    const db = initDb(freshDir());
    seedImportedPlaylist(db);

    replacePlaylistTracks(db, 1, [4, 2, 1]);

    const playlist = db
      .query<{ local_order: number }, []>("SELECT local_order FROM playlists WHERE id = 1")
      .get();
    const rows = db
      .query<{ track_id: number; source_managed: number }, []>(
        `SELECT track_id, source_managed FROM playlist_tracks
         WHERE playlist_id = 1 ORDER BY position`
      )
      .all();
    expect(playlist?.local_order).toBe(1);
    expect(rows).toEqual([
      { track_id: 4, source_managed: 0 },
      { track_id: 2, source_managed: 1 },
      { track_id: 1, source_managed: 1 },
    ]);
    db.close();
  });
});

function seedImportedPlaylist(db: ReturnType<typeof initDb>): void {
  db.run(
    "INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('qobuz', 'Qobuz', '{}', 'pin-only')"
  );
  db.run(
    "INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('s3', 'S3', '{}', 'all')"
  );
  const addTrack = db.prepare(
    `INSERT INTO tracks (source_id, source_track_id, title, artist, album, codec)
     VALUES (?, ?, ?, '', '', 'mp3')`
  );
  addTrack.run(1, "qobuz:old", "Old Qobuz");
  addTrack.run(1, "qobuz:keep", "Kept Qobuz");
  addTrack.run(1, "qobuz:new", "New Qobuz");
  addTrack.run(2, "s3:extra", "S3 Extra");
  db.run("INSERT INTO playlists (name) VALUES ('Imported')");
  db.run(
    `INSERT INTO source_playlists (source_id, source_playlist_id, playlist_id)
     VALUES (1, 'remote', 1)`
  );
  db.run(
    `INSERT INTO playlist_tracks (playlist_id, position, track_id, source_managed)
     VALUES (1, 0, 1, 1), (1, 1, 4, 0), (1, 2, 2, 1)`
  );
}
