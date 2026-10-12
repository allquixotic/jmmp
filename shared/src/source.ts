// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Codec } from "./codec.ts";

export type SourceKind = "local" | "s3" | "qobuz" | "spotify";

export type FetchMode = "auto" | "direct" | "proxy";
export type CachePolicy = "all" | "pin-only" | "none";

export interface SourceInstance {
  id: number;
  kind: SourceKind;
  name: string;
  /** Only administrators receive existing source configuration. */
  config?: SourceConfig;
  fetchMode: FetchMode;
  cachePolicy: CachePolicy;
  lastScannedAt: number | null;
  createdAt: number;
}

export type SourceConfig =
  | { kind: "local"; label: string }
  | {
      kind: "s3";
      endpoint: string;
      region: string;
      bucket: string;
      prefix?: string;
      pathStyle?: boolean;
    }
  | { kind: "qobuz"; userId: string; email: string }
  | { kind: "spotify"; clientId: string; redirectUri: string; uris: string[] };

export type SourceSecrets =
  | { kind: "local" }
  | { kind: "s3"; accessKeyId: string; secretAccessKey: string }
  | {
      kind: "qobuz";
      userAuthToken: string;
      appId: string;
      appSecret: string;
      harvestedAt: number;
    }
  | { kind: "spotify"; accessToken: string; refreshToken: string; expiresAt: number };

export interface Artist {
  id: string;
  name: string;
  sourceIds: number[];
}

export interface Album {
  id: string;
  sourceId: number;
  title: string;
  artist: string;
  albumArtist?: string;
  year?: number;
  artHash?: string;
}

export interface Track {
  /** False for legacy browser-only files until imported to the server. */
  serverAvailable?: boolean;
  id: number;
  sourceId: number;
  sourceTrackId: string;
  title: string;
  artist: string;
  albumArtist?: string;
  album: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  durationMs: number;
  codec: Codec;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  fileSize?: number;
  rgTrackDb?: number;
  rgAlbumDb?: number;
  artHash?: string;
}

export interface FileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  trackId?: number;
}

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export interface ByteRange {
  start: number;
  end?: number;
}

export type ScanEvent =
  | { kind: "add"; track: Omit<Track, "id"> }
  | { kind: "update"; track: Omit<Track, "id"> & { id?: number } }
  | { kind: "remove"; sourceTrackId: string }
  | {
      kind: "playlist";
      sourcePlaylistId: string;
      name: string;
      tracks: Array<Omit<Track, "id">>;
      skippedTracks?: number;
    };
