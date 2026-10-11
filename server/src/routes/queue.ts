// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { QueueResponse, Track } from "@jmmp/shared";
import { get, ok, post, put, readJson, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";

interface JoinedRow {
  server_available: number;
  position: number;
  added_at: number;
  id: number;
  source_id: number;
  source_track_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
  codec: string | null;
  art_hash: string | null;
}

function toTrack(r: JoinedRow): Track {
  return {
    id: r.id,
    serverAvailable: r.server_available !== 0,
    sourceId: r.source_id,
    sourceTrackId: r.source_track_id,
    title: r.title ?? "",
    artist: r.artist ?? "",
    album: r.album ?? "",
    durationMs: r.duration_ms ?? 0,
    codec: (r.codec as Track["codec"]) ?? "mp3",
    artHash: r.art_hash ?? undefined,
  };
}

get("/api/queue", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const rows = req.ctx.db
    .query<JoinedRow, []>(
      `SELECT q.position, q.added_at, t.id, t.source_id, t.source_track_id,
              t.title, t.artist, t.album, t.duration_ms, t.codec, t.art_hash, t.server_available
       FROM queue_entries q JOIN tracks t ON t.id = q.track_id
       ORDER BY q.position`
    )
    .all();
  const body: QueueResponse = {
    entries: rows.map((r) => ({
      position: r.position,
      track: toTrack(r),
      addedAt: r.added_at,
    })),
  };
  return ok(body);
});

put("/api/queue", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<{ trackIds: number[] }>(req);
  if (!Array.isArray(body.trackIds)) return ok({ replaced: 0 });
  const tx = req.ctx.db.transaction(() => {
    req.ctx.db.run("DELETE FROM queue_entries");
    const ins = req.ctx.db.prepare(
      "INSERT INTO queue_entries (position, track_id) VALUES (?, ?)"
    );
    body.trackIds.forEach((tid, i) => ins.run(i, tid));
  });
  tx();
  return ok({ replaced: body.trackIds.length });
});

post("/api/queue/append", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<{ trackIds: number[] }>(req);
  const max =
    req.ctx.db
      .query<{ p: number | null }, []>(
        "SELECT MAX(position) AS p FROM queue_entries"
      )
      .get()?.p ?? -1;
  const ins = req.ctx.db.prepare(
    "INSERT INTO queue_entries (position, track_id) VALUES (?, ?)"
  );
  let pos = (max ?? -1) + 1;
  const tx = req.ctx.db.transaction(() => {
    for (const tid of body.trackIds) ins.run(pos++, tid);
  });
  tx();
  return ok({ appended: body.trackIds.length });
});
