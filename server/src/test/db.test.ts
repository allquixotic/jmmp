// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../db.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "jmmp-test-"));
}

describe("db / migrations", () => {
  test("initDb applies migrations on a fresh DB", () => {
    const db = initDb(freshDir());
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name);
    expect(tables).toContain("passkeys");
    expect(tables).toContain("bootstrap_tokens");
    expect(tables).toContain("sources");
    expect(tables).toContain("tracks");
    expect(tables).toContain("playlists");
    expect(tables).toContain("source_playlists");
    expect(tables).toContain("art_blobs");
    expect(tables).toContain("queue_entries");
    expect(tables).toContain("history");
    expect(tables).toContain("session_devices");
    expect(tables).toContain("settings");
    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(playlist_tracks)")
      .all()
      .map((r) => r.name);
    expect(columns).toContain("source_managed");
    const playlistColumns = db
      .query<{ name: string }, []>("PRAGMA table_info(playlists)")
      .all()
      .map((r) => r.name);
    expect(playlistColumns).toContain("local_order");
    db.close();
  });

  test("FTS5 virtual table is populated by triggers", () => {
    const db = initDb(freshDir());
    db.run(
      "INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('local', 't', '{}', 'none')"
    );
    db.run(
      `INSERT INTO tracks (source_id, source_track_id, title, artist, album, codec)
       VALUES (1, 'a.mp3', 'Hello World', 'The Beatles', 'Help!', 'mp3')`
    );
    const matches = db
      .query<{ id: number }, [string]>(
        "SELECT rowid AS id FROM tracks_fts WHERE tracks_fts MATCH ?"
      )
      .all("beatles*");
    expect(matches.length).toBe(1);
    db.close();
  });

  test("migrations are idempotent", () => {
    const dir = freshDir();
    initDb(dir).close();
    // re-open: shouldn't try to re-apply.
    const db = new Database(join(dir, "jmmp.sqlite"));
    const v = db
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) AS count FROM _schema_migrations")
      .get();
    expect(v?.count).toBe(7);
    db.close();
  });
});
