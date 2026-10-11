// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type {
  Playlist,
  PlaylistListResponse,
  PlaylistStorage,
  PlaylistWithTracks,
  SourceKind,
  Track,
  SourceConfig,
} from "@jmmp/shared";
import {
  del,
  fail,
  get,
  ok,
  patch,
  post,
  readJson,
  type Req,
  type AppCtx,
} from "../router.ts";
import { requireFullSession } from "../session.ts";
import { replacePlaylistTracks } from "../playlist-tracks.ts";
import { loadAdapter } from "../sources/index.ts";
import { log } from "../log.ts";
import { importSpotifyPlaylist, spotifyPlaylistUri } from "../spotify-playlist-import.ts";
import { randomUUID } from "node:crypto";

interface SpotifyImportJob {
  did: string; jti: string; ctx: AppCtx; sourceId: number; created: number;
  status: "pending" | "complete" | "error"; playlistId?: number;
}
const spotifyImports = new Map<string, SpotifyImportJob>();
function cleanSpotifyImports() {
  for (const [id, job] of spotifyImports) {
    if (Date.now() - job.created > 10 * 60 * 1000 && job.status !== "pending") spotifyImports.delete(id);
  }
}

interface PlaylistRow {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
  pinned_at: number | null;
  track_count: number;
  local_count: number;
  source_id: number | null;
  source_playlist_id: string | null;
  source_kind: SourceKind | null;
  source_name: string | null;
}

interface TrackRow {
  server_available: number;
  id: number;
  source_id: number;
  source_track_id: string;
  title: string | null;
  artist: string | null;
  album_artist: string | null;
  album: string | null;
  year: number | null;
  track_no: number | null;
  disc_no: number | null;
  duration_ms: number | null;
  codec: string | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  file_size: number | null;
  rg_track_db: number | null;
  rg_album_db: number | null;
  art_hash: string | null;
}

function trackOf(r: TrackRow): Track {
  return {
    id: r.id,
    serverAvailable: r.server_available !== 0,
    sourceId: r.source_id,
    sourceTrackId: r.source_track_id,
    title: r.title ?? "",
    artist: r.artist ?? "",
    album: r.album ?? "",
    albumArtist: r.album_artist ?? undefined,
    year: r.year ?? undefined,
    trackNo: r.track_no ?? undefined,
    discNo: r.disc_no ?? undefined,
    durationMs: r.duration_ms ?? 0,
    codec: (r.codec as Track["codec"]) ?? "mp3",
    sampleRate: r.sample_rate ?? undefined,
    bitDepth: r.bit_depth ?? undefined,
    channels: r.channels ?? undefined,
    fileSize: r.file_size ?? undefined,
    rgTrackDb: r.rg_track_db ?? undefined,
    rgAlbumDb: r.rg_album_db ?? undefined,
    artHash: r.art_hash ?? undefined,
  };
}

function playlistOf(r: PlaylistRow): Playlist {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    trackCount: r.track_count,
    storage: storageOf(r),
    pinnedAt: r.pinned_at,
  };
}

function storageOf(r: PlaylistRow): PlaylistStorage {
  if (!r.source_id || !r.source_name || !r.source_kind || !r.source_playlist_id) {
    return { kind: "local", label: "jmmp server" };
  }
  const sourceStorage = {
    sourceId: r.source_id,
    sourceName: r.source_name,
    sourceKind: r.source_kind,
    sourcePlaylistId: r.source_playlist_id,
  };
  if (r.local_count > 0) {
    return {
      kind: "hybrid",
      label: `${r.source_name} + jmmp server`,
      ...sourceStorage,
    };
  }
  return {
    kind: "source",
    label: r.source_name,
    ...sourceStorage,
  };
}

const PLAYLIST_META_SQL = `
  SELECT p.id, p.name, p.created_at, p.updated_at, p.pinned_at,
         COUNT(pt.track_id) AS track_count,
         COALESCE(SUM(CASE WHEN pt.source_managed = 0 THEN 1 ELSE 0 END), 0) AS local_count,
         sp.source_id, sp.source_playlist_id,
         s.kind AS source_kind, s.name AS source_name
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN source_playlists sp ON sp.playlist_id = p.id
  LEFT JOIN sources s ON s.id = sp.source_id`;

const PLAYLIST_SORT_SQL = `
  CASE WHEN p.pinned_at IS NULL THEN 1 ELSE 0 END,
  p.pinned_at DESC,
  CASE WHEN TRIM(p.name) GLOB '[A-Za-z0-9]*' THEN 1 ELSE 0 END,
  lower(TRIM(p.name)),
  p.name`;

get("/api/playlists", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const rows = req.ctx.db
    .query<PlaylistRow, []>(
      `${PLAYLIST_META_SQL}
       GROUP BY p.id
       ORDER BY ${PLAYLIST_SORT_SQL}`
    )
    .all();
  const body: PlaylistListResponse = {
    playlists: rows.map(playlistOf),
  };
  return ok(body);
});

post("/api/playlists/import/spotify", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<{ sourceId?: unknown; url?: unknown }>(req);
  if (typeof body.sourceId !== "number" || !Number.isSafeInteger(body.sourceId) || body.sourceId <= 0) return fail("Choose a saved Spotify connection", 400);
  let uri: string;
  try { uri = spotifyPlaylistUri(body.url); }
  catch { return fail("Use a Spotify playlist URL", 400); }
  const source = req.ctx.db.query<{ config_json: string }, [number]>("SELECT config_json FROM sources WHERE id = ? AND kind = 'spotify'").get(body.sourceId);
  if (!source) return fail("Connect Spotify in Sources before importing playlists", 404);
  cleanSpotifyImports();
  const active = [...spotifyImports.values()].filter(job => job.ctx.db === req.ctx.db && job.status === "pending");
  if (active.some(job => job.sourceId === body.sourceId)) return fail("This Spotify connection already has an import running", 409);
  if (active.length >= 4 || spotifyImports.size >= 100) return fail("Too many playlist imports; try again shortly", 429);
  try {
    const config = JSON.parse(source.config_json) as Extract<SourceConfig, { kind: "spotify" }>;
    const jobId = randomUUID();
    const job: SpotifyImportJob = { did: session.did, jti: session.jti, ctx: req.ctx, sourceId: body.sourceId, created: Date.now(), status: "pending" };
    spotifyImports.set(jobId, job);
    // Short HTTP requests work through tunnels even for large playlists. The
    // import continues if its initiating browser navigates away or disconnects.
    void importSpotifyPlaylist(req.ctx.db, req.ctx.machineKey, body.sourceId, config, uri, req.ctx.cfg.dataDir)
      .then(id => { job.playlistId = id; job.status = "complete"; })
      .catch(() => { job.status = "error"; });
    return ok({ jobId }, { status: 202 });
  } catch {
    return fail("Spotify playlist import failed; check the URL and your saved Spotify connection", 502);
  }
});

get("/api/playlists/import/spotify/:jobId", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  cleanSpotifyImports();
  const job = spotifyImports.get(req.params.jobId!);
  if (!job || job.ctx.db !== req.ctx.db || job.did !== session.did || job.jti !== session.jti) return fail("Playlist import expired; check Playlists or try again", 404);
  if (job.status === "pending") return ok({ status: "pending" });
  if (job.status === "error") return fail("Spotify playlist import failed; check the URL and your saved Spotify connection", 502);
  const playlist = loadPlaylist(req, job.playlistId!);
  return playlist ? ok({ status: "complete", playlist }) : fail("Imported playlist was removed", 404);
});

post("/api/playlists", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<{ name?: string }>(req);
  if (!body.name?.trim()) return fail("name required", 400);
  const name = body.name.trim();
  const r = req.ctx.db.run("INSERT INTO playlists (name) VALUES (?)", [name]);
  const id = r.lastInsertRowid as number;
  await tryBindNewPlaylistToFirstQobuz(req, id, name);
  const playlist = loadPlaylist(req, id);
  if (!playlist) return fail("insert failed", 500);
  return ok(playlist, { status: 201 });
});

get("/api/playlists/:id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) return fail("bad id", 400);
  const meta = loadPlaylistRow(req, id);
  if (!meta) return fail("not found", 404);
  const trackRows = req.ctx.db
    .query<TrackRow, [number]>(
      `SELECT t.id, t.source_id, t.source_track_id, t.title, t.artist,
              t.album_artist, t.album, t.year, t.track_no, t.disc_no,
              t.duration_ms, t.codec, t.sample_rate, t.bit_depth, t.channels,
              t.file_size, t.rg_track_db, t.rg_album_db, t.art_hash, t.server_available
       FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position`
    )
    .all(id);
  const body: PlaylistWithTracks = {
    ...playlistOf(meta),
    trackCount: trackRows.length,
    tracks: trackRows.map(trackOf),
  };
  return ok(body);
});

patch("/api/playlists/:id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) return fail("bad id", 400);
  const exists = req.ctx.db
    .query<{ id: number }, [number]>("SELECT id FROM playlists WHERE id = ?")
    .get(id);
  if (!exists) return fail("not found", 404);
  const body = await readJson<{
    name?: string;
    trackIds?: number[];
    sourceId?: number | null;
    pinnedAt?: number | null;
  }>(req);
  if (body.name !== undefined) {
    if (!body.name.trim()) return fail("name required", 400);
    req.ctx.db.run(
      "UPDATE playlists SET name = ?, updated_at = unixepoch() WHERE id = ?",
      [body.name.trim(), id]
    );
  }
  if (body.sourceId !== undefined) {
    const storageError = await updatePlaylistStorage(req, id, body.sourceId);
    if (storageError) return storageError;
  }
  if (body.pinnedAt !== undefined) {
    const pinned =
      body.pinnedAt === null
        ? null
        : Number.isFinite(body.pinnedAt)
          ? Math.floor(body.pinnedAt)
          : null;
    req.ctx.db.run(
      "UPDATE playlists SET pinned_at = ?, updated_at = unixepoch() WHERE id = ?",
      [pinned, id]
    );
  }
  if (Array.isArray(body.trackIds)) {
    const syncError = await syncBoundPlaylistTracks(req, id, body.trackIds);
    if (syncError) return syncError;
    const tx = req.ctx.db.transaction(() => {
      replacePlaylistTracks(req.ctx.db, id, body.trackIds!);
    });
    tx();
  }
  return ok({ updated: id });
});

post("/api/playlists/:id/append", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) return fail("bad id", 400);
  const exists = req.ctx.db
    .query<{ id: number }, [number]>("SELECT id FROM playlists WHERE id = ?")
    .get(id);
  if (!exists) return fail("not found", 404);
  const body = await readJson<{ trackIds: number[] }>(req);
  if (!Array.isArray(body.trackIds)) return fail("trackIds required", 400);
  const currentIds = trackIdsForPlaylist(req, id);
  const nextIds = [...currentIds, ...body.trackIds];
  const syncError = await syncBoundPlaylistTracks(req, id, nextIds);
  if (syncError) return syncError;
  const sourceId = boundSourceId(req, id);
  const getTrackSource = req.ctx.db.query<{ source_id: number }, [number]>(
    "SELECT source_id FROM tracks WHERE id = ?"
  );
  const max =
    req.ctx.db
      .query<
        { p: number | null },
        [number]
      >("SELECT MAX(position) AS p FROM playlist_tracks WHERE playlist_id = ?")
      .get(id)?.p ?? -1;
  const ins = req.ctx.db.prepare(
    `INSERT INTO playlist_tracks (playlist_id, position, track_id, source_managed)
     VALUES (?, ?, ?, ?)`
  );
  let pos = (max ?? -1) + 1;
  const tx = req.ctx.db.transaction(() => {
    for (const tid of body.trackIds) {
      const trackSourceId = getTrackSource.get(tid)?.source_id;
      ins.run(id, pos++, tid, sourceId !== null && trackSourceId === sourceId ? 1 : 0);
    }
    req.ctx.db.run("UPDATE playlists SET updated_at = unixepoch() WHERE id = ?", [id]);
  });
  tx();
  return ok({ appended: body.trackIds.length });
});

del("/api/playlists/:id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.id!, 10);
  req.ctx.db.run("DELETE FROM playlists WHERE id = ?", [id]);
  return ok({ deleted: id });
});

function loadPlaylist(req: Req, playlistId: number): Playlist | null {
  const row = loadPlaylistRow(req, playlistId);
  return row ? playlistOf(row) : null;
}

function loadPlaylistRow(req: Req, playlistId: number): PlaylistRow | null {
  return (
    req.ctx.db
      .query<PlaylistRow, [number]>(
        `${PLAYLIST_META_SQL}
         WHERE p.id = ?
         GROUP BY p.id`
      )
      .get(playlistId) ?? null
  );
}

async function tryBindNewPlaylistToFirstQobuz(
  req: Req,
  playlistId: number,
  name: string
): Promise<void> {
  const source = req.ctx.db
    .query<{ id: number }, []>(
      "SELECT id FROM sources WHERE kind = 'qobuz' ORDER BY created_at, id LIMIT 1"
    )
    .get();
  if (!source) return;
  const loaded = await loadAdapter(req.ctx.db, req.ctx.machineKey, source.id);
  if (!loaded?.adapter.createPlaylist) return;
  try {
    const sourcePlaylistId = await loaded.adapter.createPlaylist(name);
    req.ctx.db.run(
      `INSERT INTO source_playlists (source_id, source_playlist_id, playlist_id)
       VALUES (?, ?, ?)`,
      [source.id, sourcePlaylistId, playlistId]
    );
  } catch (err) {
    log.warn(`new playlist Qobuz binding failed playlist=${playlistId}`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function updatePlaylistStorage(
  req: Req,
  playlistId: number,
  sourceId: number | null
): Promise<Response | null> {
  if (sourceId === null) {
    const tx = req.ctx.db.transaction(() => {
      req.ctx.db.run("DELETE FROM source_playlists WHERE playlist_id = ?", [
        playlistId,
      ]);
      req.ctx.db.run(
        `UPDATE playlist_tracks SET source_managed = 0 WHERE playlist_id = ?`,
        [playlistId]
      );
      req.ctx.db.run(
        "UPDATE playlists SET local_order = 1, updated_at = unixepoch() WHERE id = ?",
        [playlistId]
      );
    });
    tx();
    return null;
  }

  const source = req.ctx.db
    .query<{ id: number; kind: SourceKind }, [number]>(
      "SELECT id, kind FROM sources WHERE id = ?"
    )
    .get(sourceId);
  if (!source) return fail("source not found", 404);
  if (source.kind !== "qobuz") {
    return fail("playlist source binding only supports Qobuz sources", 400);
  }

  const current = req.ctx.db
    .query<{ source_id: number }, [number]>(
      "SELECT source_id FROM source_playlists WHERE playlist_id = ?"
    )
    .get(playlistId);
  if (current?.source_id === sourceId) return null;

  const playlist = req.ctx.db
    .query<{ name: string }, [number]>("SELECT name FROM playlists WHERE id = ?")
    .get(playlistId);
  if (!playlist) return fail("not found", 404);

  const loaded = await loadAdapter(req.ctx.db, req.ctx.machineKey, sourceId);
  if (!loaded?.adapter.createPlaylist || !loaded.adapter.syncPlaylistTracks) {
    return fail("Qobuz playlist binding is unavailable for this source", 500);
  }
  try {
    const sourcePlaylistId = await loaded.adapter.createPlaylist(playlist.name);
    const sourceTrackIds = orderedSourceTrackIdsForSource(
      req,
      trackIdsForPlaylist(req, playlistId),
      sourceId
    );
    await loaded.adapter.syncPlaylistTracks(sourcePlaylistId, sourceTrackIds);

    const tx = req.ctx.db.transaction(() => {
      req.ctx.db.run("DELETE FROM source_playlists WHERE playlist_id = ?", [
        playlistId,
      ]);
      req.ctx.db.run(
        `INSERT INTO source_playlists (source_id, source_playlist_id, playlist_id)
         VALUES (?, ?, ?)`,
        [sourceId, sourcePlaylistId, playlistId]
      );
      replacePlaylistTracks(req.ctx.db, playlistId, trackIdsForPlaylist(req, playlistId));
    });
    tx();
  } catch (err) {
    return fail(
      err instanceof Error
        ? `Qobuz playlist binding failed: ${err.message}`
        : `Qobuz playlist binding failed: ${String(err)}`,
      502
    );
  }
  return null;
}

async function syncBoundPlaylistTracks(
  req: Req,
  playlistId: number,
  trackIds: number[]
): Promise<Response | null> {
  const sourcePlaylist = req.ctx.db
    .query<
      { source_id: number; source_playlist_id: string; kind: string },
      [number]
    >(
      `SELECT sp.source_id, sp.source_playlist_id, s.kind
       FROM source_playlists sp JOIN sources s ON s.id = sp.source_id
       WHERE sp.playlist_id = ?`
    )
    .get(playlistId);
  if (!sourcePlaylist || sourcePlaylist.kind !== "qobuz") return null;

  const orderedSourceTrackIds = orderedSourceTrackIdsForSource(
    req,
    trackIds,
    sourcePlaylist.source_id
  );

  const loaded = await loadAdapter(
    req.ctx.db,
    req.ctx.machineKey,
    sourcePlaylist.source_id
  );
  if (!loaded?.adapter.syncPlaylistTracks) {
    return fail("Qobuz playlist sync is unavailable for this source", 500);
  }
  try {
    await loaded.adapter.syncPlaylistTracks(
      sourcePlaylist.source_playlist_id,
      orderedSourceTrackIds
    );
  } catch (err) {
    return fail(
      err instanceof Error
        ? `Qobuz playlist sync failed: ${err.message}`
        : `Qobuz playlist sync failed: ${String(err)}`,
      502
    );
  }
  return null;
}

function trackIdsForPlaylist(req: Req, playlistId: number): number[] {
  return req.ctx.db
    .query<{ track_id: number }, [number]>(
      `SELECT track_id FROM playlist_tracks
       WHERE playlist_id = ?
       ORDER BY position`
    )
    .all(playlistId)
    .map((row) => row.track_id);
}

function orderedSourceTrackIdsForSource(
  req: Req,
  trackIds: number[],
  sourceId: number
): string[] {
  const getTrack = req.ctx.db.query<
    { source_id: number; source_track_id: string },
    [number]
  >("SELECT source_id, source_track_id FROM tracks WHERE id = ?");
  return trackIds
    .map((trackId) => getTrack.get(trackId))
    .filter(
      (track): track is { source_id: number; source_track_id: string } =>
        track?.source_id === sourceId
    )
    .map((track) => track.source_track_id);
}

function boundSourceId(req: Req, playlistId: number): number | null {
  return (
    req.ctx.db
      .query<{ source_id: number }, [number]>(
        "SELECT source_id FROM source_playlists WHERE playlist_id = ?"
      )
      .get(playlistId)?.source_id ?? null
  );
}
