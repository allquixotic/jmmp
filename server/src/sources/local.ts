// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { ServerSourceAdapter } from "./types.ts";
export function makeLocalAdapter(db: Database, dataDir: string, sourceId: number): ServerSourceAdapter {
  return {
    async *scan() {},
    async fetch(sourceTrackId, range) {
      const row = db.query<{ storage_name: string; size: number }, [number, string]>(
        "SELECT storage_name, size FROM local_files WHERE source_id = ? AND source_track_id = ?"
      ).get(sourceId, sourceTrackId);
      if (!row || !/^[a-f0-9]{64}$/.test(row.storage_name)) throw new Error("This local track must be uploaded to the jmmp server before playback");
      const file = Bun.file(join(dataDir, "uploads", row.storage_name));
      if (!(await file.exists())) throw new Error("Server music file is missing; upload it again");
      const size = file.size, start = range?.start ?? 0, end = Math.min(range?.end ?? size - 1, size - 1);
      const headers = new Headers({ "accept-ranges": "bytes" });
      if (start >= size || start < 0 || end < start) return { body: new ReadableStream({ start(c) { c.close(); } }), status: 416, headers: new Headers({ "content-range": `bytes */${size}` }) };
      headers.set("content-length", String(end - start + 1));
      if (range) headers.set("content-range", `bytes ${start}-${end}/${size}`);
      return { body: file.slice(start, end + 1).stream(), status: range ? 206 : 200, headers };
    },
  };
}
