// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Database } from "bun:sqlite";
import type { SourceConfig, Track } from "@jmmp/shared";
import { makeSpotifyAdapter, normalizeSpotifyUris } from "./sources/spotify.ts";
import { prepareTrackUpsert, upsertScannedTrack } from "./catalog-tracks.ts";
import { replacePlaylistTracks } from "./playlist-tracks.ts";

export function spotifyPlaylistUri(value: unknown): string {
  const uri = normalizeSpotifyUris([value])[0]!;
  if (!uri.startsWith("spotify:playlist:")) throw new Error("Use a Spotify playlist URL");
  return uri;
}

/** Fetch metadata first; publish the complete local snapshot in one transaction. */
export async function importSpotifyPlaylist(
  db: Database, key: CryptoKey, sourceId: number,
  config: Extract<SourceConfig, { kind: "spotify" }>, uri: string,
  dataDir: string, signal?: AbortSignal, onProgress?: (tracks: number) => void,
): Promise<{ playlistId: number; skippedTracks: number }> {
  const adapter = makeSpotifyAdapter(db, key, sourceId, { ...config, uris: [uri] }, dataDir);
  let playlist: { name: string; tracks: Array<Omit<Track, "id">> } | undefined;
  let skippedTracks = 0;
  const deadline = AbortSignal.timeout(5 * 60 * 1000);
  const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let loaded = 0;
  for await (const event of adapter.scan({ signal: cancellation })) {
    if (event.kind === "add") onProgress?.(++loaded);
    if (event.kind === "playlist") {
      if (playlist || event.sourcePlaylistId !== uri || event.tracks.length > 10000) throw new Error("Invalid Spotify playlist metadata");
      playlist = { name: event.name, tracks: event.tracks };
      skippedTracks = event.skippedTracks ?? 0;
      if (!Number.isSafeInteger(skippedTracks) || skippedTracks < 0 || event.tracks.length + skippedTracks > 10000) throw new Error("Invalid Spotify playlist metadata");
    }
  }
  cancellation.throwIfAborted();
  if (!playlist) throw new Error("Spotify did not return a complete playlist");
  const snapshot = playlist;
  const upsert = prepareTrackUpsert(db);
  const find = db.query<{ id: number }, [number, string]>("SELECT id FROM tracks WHERE source_id = ? AND source_track_id = ?");
  return db.transaction(() => {
    // The saved account may have been removed while metadata was loading.
    if (!db.query("SELECT id FROM sources WHERE id = ? AND kind = 'spotify'").get(sourceId)) throw new Error("Spotify connection removed");
    const ids = snapshot.tracks.map(track => {
      if (!track.sourceTrackId.startsWith("spotify:track:") || !upsertScannedTrack(sourceId, track, upsert)) throw new Error("Unsupported Spotify playlist item");
      return find.get(sourceId, track.sourceTrackId)!.id;
    });
    const inserted = db.run("INSERT INTO playlists (name) VALUES (?)", [snapshot.name.trim() || "Spotify playlist"]);
    const id = Number(inserted.lastInsertRowid);
    // Bypass source binding, including the normal new-playlist Qobuz default.
    replacePlaylistTracks(db, id, ids);
    return { playlistId: id, skippedTracks };
  })();
}
