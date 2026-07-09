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

function seedSearchCatalog() {
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
  return { db, addTrack };
}

describe("catalog search", () => {
  test("finds local/S3 albums and artists directly from indexed metadata", () => {
    const { db, addTrack } = seedSearchCatalog();
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

  test("escapes printable punctuation and filters control characters before FTS", () => {
    const { db, addTrack } = seedSearchCatalog();
    addTrack.run(
      1,
      "s3/mary.mp3",
      "Love, Long Distance",
      "Mary Hopkin",
      "Mary Hopkin",
      "Earth Song/Ocean Song"
    );

    const comma = searchLocalCatalog(db, "love,", { sourceId: null, field: "any" });
    expect(comma.tracks.map((track) => track.title)).toEqual(["Love, Long Distance"]);

    const printableAscii = Array.from({ length: 95 }, (_, i) =>
      String.fromCharCode(i + 32)
    ).join("");
    expect(() =>
      searchLocalCatalog(db, printableAscii, { sourceId: null, field: "any" })
    ).not.toThrow();

    const withControls = searchLocalCatalog(
      db,
      "\u0000love,\u001flong\u007fdistance",
      { sourceId: null, field: "any" }
    );
    expect(withControls.tracks.map((track) => track.title)).toEqual([
      "Love, Long Distance",
    ]);
    db.close();
  });

  test("matches punctuation-insensitive title tokens and scoped fields", () => {
    const { db, addTrack } = seedSearchCatalog();
    addTrack.run(
      1,
      "s3/mary.mp3",
      "Love, Long Distance",
      "Mary Hopkin",
      "Mary Hopkin",
      "Earth Song/Ocean Song"
    );

    const byTitle = searchLocalCatalog(db, "love long distance", {
      sourceId: null,
      field: "title",
    });
    expect(byTitle.tracks.map((track) => track.title)).toEqual([
      "Love, Long Distance",
    ]);

    const byArtist = searchLocalCatalog(db, "mary hopkin", {
      sourceId: null,
      field: "artist",
    });
    expect(byArtist.tracks.map((track) => track.artist)).toEqual(["Mary Hopkin"]);

    const byAlbum = searchLocalCatalog(db, "earth ocean", {
      sourceId: null,
      field: "album",
    });
    expect(byAlbum.tracks.map((track) => track.album)).toEqual([
      "Earth Song/Ocean Song",
    ]);
    db.close();
  });

  test("ranks artist plus title coverage before title-only noise", () => {
    const { db, addTrack } = seedSearchCatalog();
    addTrack.run(
      1,
      "s3/mary.mp3",
      "Love, Long Distance",
      "Mary Hopkin",
      "Mary Hopkin",
      "Earth Song/Ocean Song"
    );
    addTrack.run(
      1,
      "s3/noise.mp3",
      "Mary Hopkin Love Long Distance",
      "Other Artist",
      "Other Artist",
      "Search Noise"
    );

    const result = searchLocalCatalog(db, "mary hopkin love long distance", {
      sourceId: null,
      field: "any",
    });
    expect(result.tracks[0]?.artist).toBe("Mary Hopkin");
    expect(result.tracks[0]?.title).toBe("Love, Long Distance");
    db.close();
  });

  test("merges exact-name artists across sources", () => {
    const { db, addTrack } = seedSearchCatalog();
    addTrack.run(
      1,
      "s3/mary.mp3",
      "Love, Long Distance",
      "Mary Hopkin",
      "Mary Hopkin",
      "Earth Song/Ocean Song"
    );
    addTrack.run(
      2,
      "qobuz/mary",
      "Those Were The Days",
      "Mary Hopkin",
      "Mary Hopkin",
      "Post Card"
    );

    const result = searchLocalCatalog(db, "Mary Hopkin", {
      sourceId: null,
      field: "artist",
    });
    expect(result.artists).toEqual([
      { id: "Mary Hopkin", name: "Mary Hopkin", sourceIds: [1, 2] },
    ]);
    db.close();
  });
});
