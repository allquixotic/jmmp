// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { log } from "./log.ts";
import migration0001 from "./migrations/0001_initial.sql" with { type: "text" };
import migration0002 from "./migrations/0002_source_playlists.sql" with { type: "text" };
import migration0003 from "./migrations/0003_art_blobs.sql" with { type: "text" };
import migration0004 from "./migrations/0004_playlist_track_overlays.sql" with { type: "text" };
import migration0005 from "./migrations/0005_playlist_local_order.sql" with { type: "text" };
import migration0006 from "./migrations/0006_playlist_pinned.sql" with { type: "text" };
import migration0007 from "./migrations/0007_local_files.sql" with { type: "text" };

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: MigrationFile[] = [
  { version: 1, name: "0001_initial.sql", sql: migration0001 as unknown as string },
  {
    version: 2,
    name: "0002_source_playlists.sql",
    sql: migration0002 as unknown as string,
  },
  { version: 3, name: "0003_art_blobs.sql", sql: migration0003 as unknown as string },
  {
    version: 4,
    name: "0004_playlist_track_overlays.sql",
    sql: migration0004 as unknown as string,
  },
  {
    version: 5,
    name: "0005_playlist_local_order.sql",
    sql: migration0005 as unknown as string,
  },
  {
    version: 6,
    name: "0006_playlist_pinned.sql",
    sql: migration0006 as unknown as string,
  },
  { version: 7, name: "0007_local_files.sql", sql: migration0007 as unknown as string },
];

export function initDb(dataDir: string): Database {
  const dbPath = join(dataDir, "jmmp.sqlite");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  const applied = new Set(
    db
      .query<{ version: number }, []>("SELECT version FROM _schema_migrations")
      .all()
      .map((r) => r.version)
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    log.info(`applying migration ${m.name}`);
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.run("INSERT INTO _schema_migrations (version) VALUES (?)", [m.version]);
    });
    tx();
  }
}
