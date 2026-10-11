// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { codecFromExtension } from "@jmmp/shared";
import { post, fail, ok } from "../router.ts";
import { requireFullSession } from "../session.ts";
import { extractMetadata } from "../sources/metadata.ts";

post("/api/sources/:id/upload", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  const sourceId = Number(req.params.id);
  const source = req.ctx.db.query<{ kind: string }, [number]>("SELECT kind FROM sources WHERE id = ?").get(sourceId);
  if (source?.kind !== "local") return fail("Upload requires a local source", 400);
  const path = req.url.searchParams.get("path") ?? "";
  if (!path || path.length > 2048 || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..") || /[\x00-\x1f]/.test(path)) return fail("Invalid relative file path", 400);
  const codec = codecFromExtension(path); if (!codec) return fail("Unsupported audio format", 400);
  if (!req.request.body) return fail("Audio file required", 400);
  const dir = join(req.ctx.cfg.dataDir, "uploads"); await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `${crypto.randomUUID()}.part`);
  const hash = createHash("sha256"); let size = 0;
  try {
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > 4 * 1024 ** 3) return callback(new Error("Upload exceeds 4 GiB"));
      hash.update(chunk); callback(null, chunk);
    }});
    await pipeline(Readable.fromWeb(req.request.body as any), counter, createWriteStream(temporary, { mode: 0o600, flags: "wx" }), { signal: req.request.signal });
    if (!size) return fail("Empty audio file", 400);
    const storage = hash.digest("hex");
    const metadata = await extractMetadata(new Uint8Array(await Bun.file(temporary).slice(0, 1024 * 1024).arrayBuffer()), codec, size);
    await rename(temporary, join(dir, storage));
    req.ctx.db.run(`INSERT INTO local_files (source_id, source_track_id, storage_name, size) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_id, source_track_id) DO UPDATE SET storage_name = excluded.storage_name, size = excluded.size`, [sourceId, path, storage, size]);
    return ok({ track: { sourceId, sourceTrackId: path, title: path.split("/").pop()!.replace(/\.[^.]+$/, ""), artist: "", album: "", durationMs: 0, ...metadata, codec, fileSize: size } });
  } finally { await rm(temporary, { force: true }); }
});
