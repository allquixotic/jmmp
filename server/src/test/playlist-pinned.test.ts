// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../db.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "jmmp-pin-"));
}

describe("playlist pinning", () => {
  test("pinned_at column starts null after migration", () => {
    const db = initDb(freshDir());
    db.run("INSERT INTO playlists (name) VALUES ('First')");
    const row = db
      .query<{ pinned_at: number | null }, []>(
        "SELECT pinned_at FROM playlists WHERE id = 1"
      )
      .get();
    expect(row?.pinned_at).toBeNull();
    db.close();
  });

  test("pinned playlists sort above unpinned, most-recently pinned first", () => {
    const db = initDb(freshDir());
    db.run("INSERT INTO playlists (id, name, pinned_at) VALUES (1, 'Alpha', NULL)");
    db.run("INSERT INTO playlists (id, name, pinned_at) VALUES (2, 'Beta', 100)");
    db.run("INSERT INTO playlists (id, name, pinned_at) VALUES (3, 'Gamma', 200)");
    db.run("INSERT INTO playlists (id, name, pinned_at) VALUES (4, 'Delta', NULL)");

    const rows = db
      .query<{ name: string }, []>(
        `SELECT name FROM playlists
         ORDER BY
           CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END,
           pinned_at DESC,
           CASE WHEN TRIM(name) GLOB '[A-Za-z0-9]*' THEN 1 ELSE 0 END,
           lower(TRIM(name)),
           name`
      )
      .all();

    expect(rows.map((r) => r.name)).toEqual(["Gamma", "Beta", "Alpha", "Delta"]);
    db.close();
  });

  test("setting pinned_at to NULL unpins", () => {
    const db = initDb(freshDir());
    db.run("INSERT INTO playlists (id, name, pinned_at) VALUES (1, 'P', 500)");
    db.run("UPDATE playlists SET pinned_at = NULL WHERE id = 1");
    const row = db
      .query<{ pinned_at: number | null }, []>(
        "SELECT pinned_at FROM playlists WHERE id = 1"
      )
      .get();
    expect(row?.pinned_at).toBeNull();
    db.close();
  });
});
