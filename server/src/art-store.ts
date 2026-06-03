// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Database } from "bun:sqlite";
import type { ExtractedArt } from "./sources/art.ts";
import { artReference } from "./sources/art.ts";

export interface StoredArtRow {
  mime: string;
  data: Uint8Array;
}

export function storeArtBlob(db: Database, art: ExtractedArt): string {
  db.query(
    `INSERT INTO art_blobs (hash, mime, data)
     VALUES (?, ?, ?)
     ON CONFLICT(hash) DO NOTHING`
  ).run(art.hash, art.mime, art.data);
  return artReference(art.hash);
}

export function getArtBlob(db: Database, hash: string): StoredArtRow | null {
  return (
    db
      .query<StoredArtRow, [string]>("SELECT mime, data FROM art_blobs WHERE hash = ?")
      .get(hash) ?? null
  );
}
