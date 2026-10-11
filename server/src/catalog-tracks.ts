// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Database } from "bun:sqlite";
import { codecFromExtension, type Track } from "@jmmp/shared";

export function prepareTrackUpsert(db: Database) {
  return db.prepare(
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
}

export function upsertScannedTrack(
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

export function scannedDurationMs(durationMs: number | undefined): number | null {
  return typeof durationMs === "number" && durationMs > 0 ? durationMs : null;
}
