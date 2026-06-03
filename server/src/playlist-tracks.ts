// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Database } from "bun:sqlite";

interface PlaylistTrackRow {
  track_id: number;
  source_managed: number;
}

export function replacePlaylistTracks(
  db: Database,
  playlistId: number,
  trackIds: number[]
): void {
  const sourceId = playlistSourceId(db, playlistId);
  const getTrackSource = db.query<{ source_id: number }, [number]>(
    "SELECT source_id FROM tracks WHERE id = ?"
  );
  const ins = db.prepare(
    `INSERT INTO playlist_tracks (playlist_id, position, track_id, source_managed)
     VALUES (?, ?, ?, ?)`
  );

  db.run("DELETE FROM playlist_tracks WHERE playlist_id = ?", [playlistId]);
  trackIds.forEach((trackId, position) => {
    const trackSourceId = getTrackSource.get(trackId)?.source_id;
    const sourceManaged =
      sourceId !== null && trackSourceId === sourceId ? 1 : 0;
    ins.run(playlistId, position, trackId, sourceManaged);
  });
  db.run(
    "UPDATE playlists SET local_order = 1, updated_at = unixepoch() WHERE id = ?",
    [playlistId]
  );
}

export function rebuildSourcePlaylistTracks(
  db: Database,
  playlistId: number,
  sourceTrackIds: number[]
): void {
  const localOrder = db
    .query<{ local_order: number }, [number]>(
      "SELECT local_order FROM playlists WHERE id = ?"
    )
    .get(playlistId)?.local_order === 1;
  const rows = db
    .query<PlaylistTrackRow, [number]>(
      `SELECT track_id, source_managed FROM playlist_tracks
       WHERE playlist_id = ?
       ORDER BY position`
    )
    .all(playlistId);
  const merged = localOrder
    ? mergeWithLocalOrder(rows, sourceTrackIds)
    : mergeWithSourceOrder(rows, sourceTrackIds);
  const ins = db.prepare(
    `INSERT INTO playlist_tracks (playlist_id, position, track_id, source_managed)
     VALUES (?, ?, ?, ?)`
  );

  db.run("DELETE FROM playlist_tracks WHERE playlist_id = ?", [playlistId]);
  merged.forEach((row, position) => {
    ins.run(playlistId, position, row.trackId, row.sourceManaged);
  });
}

function playlistSourceId(db: Database, playlistId: number): number | null {
  return (
    db
      .query<{ source_id: number }, [number]>(
        "SELECT source_id FROM source_playlists WHERE playlist_id = ?"
      )
      .get(playlistId)?.source_id ?? null
  );
}

function mergeWithSourceOrder(
  rows: PlaylistTrackRow[],
  sourceTrackIds: number[]
): Array<{ trackId: number; sourceManaged: number }> {
  const sourceCounts = countTrackIds(sourceTrackIds);
  const localTrackIds = rows
    .filter((row) => row.source_managed === 0 && !hasCount(sourceCounts, row.track_id))
    .map((row) => row.track_id);
  return [
    ...sourceTrackIds.map((trackId) => ({ trackId, sourceManaged: 1 })),
    ...localTrackIds.map((trackId) => ({ trackId, sourceManaged: 0 })),
  ];
}

function mergeWithLocalOrder(
  rows: PlaylistTrackRow[],
  sourceTrackIds: number[]
): Array<{ trackId: number; sourceManaged: number }> {
  const remainingSourceCounts = countTrackIds(sourceTrackIds);
  const merged: Array<{ trackId: number; sourceManaged: number }> = [];
  for (const row of rows) {
    if (row.source_managed === 1) {
      if (consumeCount(remainingSourceCounts, row.track_id)) {
        merged.push({ trackId: row.track_id, sourceManaged: 1 });
      }
      continue;
    }
    if (!hasCount(remainingSourceCounts, row.track_id)) {
      merged.push({ trackId: row.track_id, sourceManaged: 0 });
    }
  }
  for (const trackId of sourceTrackIds) {
    if (consumeCount(remainingSourceCounts, trackId)) {
      merged.push({ trackId, sourceManaged: 1 });
    }
  }
  return merged;
}

function countTrackIds(trackIds: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const trackId of trackIds) {
    counts.set(trackId, (counts.get(trackId) ?? 0) + 1);
  }
  return counts;
}

function hasCount(counts: Map<number, number>, trackId: number): boolean {
  return (counts.get(trackId) ?? 0) > 0;
}

function consumeCount(counts: Map<number, number>, trackId: number): boolean {
  const count = counts.get(trackId) ?? 0;
  if (count <= 0) return false;
  if (count === 1) counts.delete(trackId);
  else counts.set(trackId, count - 1);
  return true;
}
