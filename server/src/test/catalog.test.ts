// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../db.ts";
import { searchLocalCatalog } from "../routes/catalog.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "jmmp-test-"));
}

describe("catalog search", () => {
  test("finds local/S3 albums and artists directly from indexed metadata", () => {
    const db = initDb(freshDir());
    db.run(
      "INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('s3', 'S3', '{}', 'all')"
    );
    db.run(
      "INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('qobuz', 'Qobuz', '{}', 'pin-only')"
    );
    const addTrack = db.prepare(
      `INSERT INTO tracks (source_id, source_track_id, title, artist, album_artist, album, codec)
       VALUES (?, ?, ?, ?, ?, ?, 'mp3')`
    );
    addTrack.run(1, "s3/glass-1.mp3", "First Light", "Museum Fire", "Museum Fire", "Glass Cities");
    addTrack.run(1, "s3/glass-2.mp3", "Last Light", "Museum Fire", "Museum Fire", "Glass Cities");
    addTrack.run(2, "qobuz/other", "Glass Road", "Other Artist", null, "Other Album");

    const byAlbum = searchLocalCatalog(db, "Glass", {
      sourceId: 1,
      field: "album",
    });
    expect(byAlbum.tracks.map((track) => track.sourceId)).toEqual([1, 1]);
    expect(byAlbum.albums.map((album) => album.title)).toEqual(["Glass Cities"]);
    expect(byAlbum.artists).toEqual([]);

    const byArtist = searchLocalCatalog(db, "Museum", {
      sourceId: 1,
      field: "artist",
    });
    expect(byArtist.albums.map((album) => album.title)).toEqual(["Glass Cities"]);
    expect(byArtist.artists.map((artist) => artist.name)).toEqual(["Museum Fire"]);
    db.close();
  });
});
