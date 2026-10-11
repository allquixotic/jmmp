// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { HistoryResponse, Track } from "@jmmp/shared";
import { fail, get, ok, post, readJson, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";

interface HistoryRow {
  server_available: number;
  id: number;
  played_at: number;
  played_to_completion: number;
  device_id: string | null;
  track_id: number;
  source_id: number;
  source_track_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
  codec: string | null;
  art_hash: string | null;
}

function toTrack(r: HistoryRow): Track {
  return {
    id: r.track_id,
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

get("/api/history", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const limit = clamp(parseInt(req.url.searchParams.get("limit") ?? "100", 10), 1, 500);
  const cursor = parseInt(req.url.searchParams.get("cursor") ?? "", 10);

  const condition = Number.isFinite(cursor) ? "AND h.id < ?" : "";
  const params: unknown[] = Number.isFinite(cursor) ? [cursor, limit] : [limit];

  const rows = req.ctx.db
    .query<HistoryRow, typeof params>(
      `SELECT h.id, h.played_at, h.played_to_completion, h.device_id,
              t.id AS track_id, t.source_id, t.source_track_id, t.title, t.artist,
              t.album, t.duration_ms, t.codec, t.art_hash, t.server_available
       FROM history h JOIN tracks t ON t.id = h.track_id
       WHERE 1=1 ${condition}
       ORDER BY h.id DESC
       LIMIT ?`
    )
    .all(...params);

  const entries = rows.map((r) => ({
    id: r.id,
    track: toTrack(r),
    playedAt: r.played_at,
    playedToCompletion: r.played_to_completion === 1,
  }));
  const last = entries[entries.length - 1];
  const body: HistoryResponse = {
    entries,
    nextCursor: entries.length === limit && last ? last.id : null,
  };
  return ok(body);
});

post("/api/history", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<{
    trackId: number;
    playedAt?: number;
    playedToCompletion?: boolean;
  }>(req);
  if (!body.trackId) return fail("trackId required", 400);
  req.ctx.db.run(
    `INSERT INTO history (track_id, played_at, played_to_completion, device_id)
     VALUES (?, ?, ?, ?)`,
    [
      body.trackId,
      body.playedAt ?? Math.floor(Date.now() / 1000),
      body.playedToCompletion ? 1 : 0,
      session.did,
    ]
  );
  return ok({});
});

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}
