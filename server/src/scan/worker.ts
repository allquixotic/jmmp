// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Database } from "bun:sqlite";
import { codecFromExtension, type Track } from "@jmmp/shared";
import { loadAdapter } from "../sources/index.ts";
import { extractMetadata } from "../sources/metadata.ts";
import { extractEmbeddedArt } from "../sources/art.ts";
import { storeArtBlob } from "../art-store.ts";
import { log } from "../log.ts";
import { rebuildSourcePlaylistTracks } from "../playlist-tracks.ts";

export interface ScanProgress {
  sourceId: number;
  state: "running" | "idle" | "error";
  scanned: number;
  total?: number;
  startedAt: number;
  error?: string;
}

const progressByScan = new Map<number, ScanProgress>();

export function getScanProgress(sourceId: number): ScanProgress | undefined {
  return progressByScan.get(sourceId);
}

export async function runScan(
  db: Database,
  machineKey: CryptoKey,
  sourceId: number,
  opts: { extractMetadata: boolean }
): Promise<void> {
  const existing = progressByScan.get(sourceId);
  if (existing?.state === "running") return;
  progressByScan.set(sourceId, {
    sourceId,
    state: "running",
    scanned: 0,
    startedAt: Math.floor(Date.now() / 1000),
  });

  const loaded = await loadAdapter(db, machineKey, sourceId);
  if (!loaded) {
    progressByScan.set(sourceId, {
      sourceId,
      state: "error",
      scanned: 0,
      startedAt: Math.floor(Date.now() / 1000),
      error: "source not found",
    });
    return;
  }

  const upsert = db.prepare(
    `INSERT INTO tracks (
        source_id, source_track_id, title, artist, album_artist, album, year,
        track_no, disc_no, duration_ms, codec, sample_rate, bit_depth, channels,
        file_size, rg_track_db, rg_album_db, art_hash, mtime, etag, last_seen_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(source_id, source_track_id) DO UPDATE SET
       title = COALESCE(excluded.title, tracks.title),
       artist = COALESCE(excluded.artist, tracks.artist),
       album_artist = COALESCE(excluded.album_artist, tracks.album_artist),
       album = COALESCE(excluded.album, tracks.album),
       year = COALESCE(excluded.year, tracks.year),
       track_no = COALESCE(excluded.track_no, tracks.track_no),
       disc_no = COALESCE(excluded.disc_no, tracks.disc_no),
       duration_ms = COALESCE(excluded.duration_ms, tracks.duration_ms),
       codec = excluded.codec,
       sample_rate = COALESCE(excluded.sample_rate, tracks.sample_rate),
       bit_depth = COALESCE(excluded.bit_depth, tracks.bit_depth),
       channels = COALESCE(excluded.channels, tracks.channels),
       file_size = COALESCE(excluded.file_size, tracks.file_size),
       rg_track_db = COALESCE(excluded.rg_track_db, tracks.rg_track_db),
       rg_album_db = COALESCE(excluded.rg_album_db, tracks.rg_album_db),
       art_hash = COALESCE(excluded.art_hash, tracks.art_hash),
       mtime = COALESCE(excluded.mtime, tracks.mtime),
       etag = COALESCE(excluded.etag, tracks.etag),
       last_seen_at = unixepoch()`
  );

  const seenKeys = new Set<string>();
  const seenPlaylistKeys = new Set<string>();
  let scanned = 0;
  try {
    for await (const event of loaded.adapter.scan({})) {
      if (event.kind === "add" || event.kind === "update") {
        if (upsertScannedTrack(sourceId, event.track, upsert)) {
          seenKeys.add(event.track.sourceTrackId);
          scanned++;
        }
      } else if (event.kind === "playlist") {
        const trackIds: number[] = [];
        for (const t of event.tracks) {
          if (!upsertScannedTrack(sourceId, t, upsert)) continue;
          seenKeys.add(t.sourceTrackId);
          scanned++;
          const row = db
            .query<{ id: number }, [number, string]>(
              "SELECT id FROM tracks WHERE source_id = ? AND source_track_id = ?"
            )
            .get(sourceId, t.sourceTrackId);
          if (row) trackIds.push(row.id);
        }
        upsertSourcePlaylist(db, sourceId, event.sourcePlaylistId, event.name, trackIds);
        seenPlaylistKeys.add(event.sourcePlaylistId);
      }
      if (event.kind !== "remove") {
        if (scanned % 50 === 0) {
          progressByScan.set(sourceId, {
            sourceId,
            state: "running",
            scanned,
            startedAt: progressByScan.get(sourceId)!.startedAt,
          });
        }
      }
    }

    // Tombstone tracks no longer seen.
    db.run(
      `DELETE FROM tracks WHERE source_id = ?
       AND source_track_id NOT IN (
         SELECT value FROM json_each(?)
       )`,
      [sourceId, JSON.stringify([...seenKeys])]
    );
    removeStaleSourcePlaylists(db, sourceId, seenPlaylistKeys);

    db.run("UPDATE sources SET last_scanned_at = unixepoch() WHERE id = ?", [sourceId]);
    progressByScan.set(sourceId, {
      sourceId,
      state: "idle",
      scanned,
      startedAt: progressByScan.get(sourceId)!.startedAt,
    });
    log.info(`scan complete source=${sourceId} tracks=${scanned}`);

    if (opts.extractMetadata) {
      void backgroundEnrich(db, machineKey, sourceId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    progressByScan.set(sourceId, {
      sourceId,
      state: "error",
      scanned,
      startedAt: progressByScan.get(sourceId)!.startedAt,
      error: message,
    });
    log.error(`scan failed source=${sourceId}`, { err: message });
  }
}

function upsertScannedTrack(
  sourceId: number,
  t: Omit<Track, "id">,
  upsert: ReturnType<Database["prepare"]>
): boolean {
  const codec = t.codec ?? codecFromExtension(t.sourceTrackId);
  if (!codec) return false;
  upsert.run(
    sourceId,
    t.sourceTrackId,
    t.title ?? null,
    t.artist ?? null,
    t.albumArtist ?? null,
    t.album ?? null,
    t.year ?? null,
    t.trackNo ?? null,
    t.discNo ?? null,
    scannedDurationMs(t.durationMs),
    codec,
    t.sampleRate ?? null,
    t.bitDepth ?? null,
    t.channels ?? null,
    t.fileSize ?? null,
    t.rgTrackDb ?? null,
    t.rgAlbumDb ?? null,
    t.artHash ?? null,
    (t as { mtime?: number }).mtime ?? null,
    (t as { etag?: string }).etag ?? null
  );
  return true;
}

function upsertSourcePlaylist(
  db: Database,
  sourceId: number,
  sourcePlaylistId: string,
  name: string,
  trackIds: number[]
): void {
  const existing = db
    .query<{ playlist_id: number }, [number, string]>(
      "SELECT playlist_id FROM source_playlists WHERE source_id = ? AND source_playlist_id = ?"
    )
    .get(sourceId, sourcePlaylistId);

  const tx = db.transaction(() => {
    let playlistId = existing?.playlist_id;
    if (playlistId) {
      db.run("UPDATE playlists SET name = ?, updated_at = unixepoch() WHERE id = ?", [
        name,
        playlistId,
      ]);
      db.run(
        "UPDATE source_playlists SET updated_at = unixepoch() WHERE source_id = ? AND source_playlist_id = ?",
        [sourceId, sourcePlaylistId]
      );
    } else {
      const inserted = db.run("INSERT INTO playlists (name) VALUES (?)", [name]);
      playlistId = inserted.lastInsertRowid as number;
      db.run(
        `INSERT INTO source_playlists (source_id, source_playlist_id, playlist_id)
         VALUES (?, ?, ?)`,
        [sourceId, sourcePlaylistId, playlistId]
      );
    }

    rebuildSourcePlaylistTracks(db, playlistId!, trackIds);
  });
  tx();
}

function removeStaleSourcePlaylists(
  db: Database,
  sourceId: number,
  seenPlaylistKeys: Set<string>
): void {
  const stale = db
    .query<{ playlist_id: number }, [number, string]>(
      `SELECT playlist_id FROM source_playlists
       WHERE source_id = ?
       AND source_playlist_id NOT IN (SELECT value FROM json_each(?))`
    )
    .all(sourceId, JSON.stringify([...seenPlaylistKeys]));
  const del = db.prepare("DELETE FROM playlists WHERE id = ?");
  const tx = db.transaction(() => {
    for (const row of stale) del.run(row.playlist_id);
  });
  tx();
}

async function backgroundEnrich(
  db: Database,
  machineKey: CryptoKey,
  sourceId: number
): Promise<void> {
  const loaded = await loadAdapter(db, machineKey, sourceId);
  if (!loaded) return;
  const stale = db
    .query<
      { id: number; source_track_id: string; codec: string; file_size: number | null },
      [number]
    >(
      `SELECT id, source_track_id, codec, file_size FROM tracks
       WHERE source_id = ?
       AND (
         title IS NULL OR title = '' OR sample_rate IS NULL OR art_hash IS NULL
         OR duration_ms IS NULL OR duration_ms <= 0
         OR codec = 'mp3'
       )
       LIMIT 500`
    )
    .all(sourceId);

  const update = db.prepare(
    `UPDATE tracks SET
        title = COALESCE(?, title), artist = COALESCE(?, artist),
        album_artist = COALESCE(?, album_artist), album = COALESCE(?, album),
        year = COALESCE(?, year), track_no = COALESCE(?, track_no),
        disc_no = COALESCE(?, disc_no), duration_ms = COALESCE(?, duration_ms),
        sample_rate = COALESCE(?, sample_rate), bit_depth = COALESCE(?, bit_depth),
        channels = COALESCE(?, channels),
        rg_track_db = COALESCE(?, rg_track_db), rg_album_db = COALESCE(?, rg_album_db),
        art_hash = COALESCE(?, art_hash)
     WHERE id = ?`
  );

  for (const t of stale) {
    try {
      const upstream = await loaded.adapter.fetch(t.source_track_id, {
        start: 0,
        end: Math.min(1_048_575, (t.file_size ?? 1_048_576) - 1),
      });
      const buf = new Uint8Array(await new Response(upstream.body).arrayBuffer());
      const codec = t.codec as "mp3" | "flac" | "vorbis" | "opus";
      const meta = await extractMetadata(buf, codec, t.file_size ?? undefined);
      const art = extractEmbeddedArt(buf, codec);
      const artHash = art ? storeArtBlob(db, art) : null;
      update.run(
        meta.title ?? null,
        meta.artist ?? null,
        meta.albumArtist ?? null,
        meta.album ?? null,
        meta.year ?? null,
        meta.trackNo ?? null,
        meta.discNo ?? null,
        meta.durationMs ?? null,
        meta.sampleRate ?? null,
        meta.bitDepth ?? null,
        meta.channels ?? null,
        meta.rgTrackDb ?? null,
        meta.rgAlbumDb ?? null,
        artHash,
        t.id
      );
    } catch (err) {
      log.warn(`enrich failed track=${t.id}`, {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function scannedDurationMs(durationMs: number | undefined): number | null {
  return typeof durationMs === "number" && durationMs > 0 ? durationMs : null;
}
