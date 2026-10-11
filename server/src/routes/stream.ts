// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { fail, get, type Req } from "../router.ts";
import { playbackController } from "../audio/controller.ts";
import { requireFullSession } from "../session.ts";
import { loadAdapter } from "../sources/index.ts";

interface TrackRow {
  id: number;
  source_id: number;
  source_track_id: string;
  codec: string;
}

get("/api/stream/:track_id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  if (!playbackController(req.ctx).browserStreamingAllowed) return fail("Source streaming is disabled during MoQ playback", 409);
  const trackId = parseInt(req.params.track_id!, 10);
  if (!Number.isFinite(trackId)) return fail("bad track id", 400);

  const track = req.ctx.db
    .query<TrackRow, [number]>(
      "SELECT id, source_id, source_track_id, codec FROM tracks WHERE id = ?"
    )
    .get(trackId);
  if (!track) return fail("track not found", 404);

  const adapter = await loadAdapter(req.ctx.db, req.ctx.machineKey, track.source_id, req.ctx.cfg.dataDir);
  if (!adapter) return fail("source not found or not server-fetchable", 404);

  const range = parseRange(req.request.headers.get("range"));
  const upstream = await adapter.adapter.fetch(track.source_track_id, range);
  // Enabling output can race an upstream request that has not returned yet.
  if (!playbackController(req.ctx).browserStreamingAllowed) {
    await upstream.body.cancel().catch(() => {});
    return fail("Source streaming is disabled during MoQ playback", 409);
  }

  const headers = new Headers();
  passthrough(upstream.headers, headers, [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]);
  if (!headers.has("content-type")) headers.set("content-type", codecMime(track.codec));
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  return new Response(playbackController(req.ctx).clientStream(upstream.body), { status: upstream.status, headers });
});

function parseRange(header: string | null) {
  if (!header) return undefined;
  const m = header.match(/^bytes=(\d+)-(\d+)?$/);
  if (!m) return undefined;
  return {
    start: parseInt(m[1]!, 10),
    end: m[2] ? parseInt(m[2], 10) : undefined,
  };
}

function passthrough(src: Headers, dst: Headers, names: string[]): void {
  for (const n of names) {
    const v = src.get(n);
    if (v) dst.set(n, v);
  }
}

function codecMime(codec: string): string {
  switch (codec) {
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "opus":
      return "audio/ogg";
    case "vorbis":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}
