// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type {
  Album,
  Artist,
  CachePolicy,
  FetchMode,
  FileEntry,
  SearchResult,
  SourceConfig,
  SourceInstance,
  SourceKind,
  Track,
} from "./source.ts";
import type { HistoryEntry, Playlist, PlaylistWithTracks, QueueEntry } from "./catalog.ts";
import type { UserSettings } from "./settings.ts";

export interface AuthStatusResponse {
  hasPasskeys: boolean;
  hasBootstrapToken: boolean;
  hasFullSession: boolean;
  hasRegistrationSession: boolean;
}

export interface BootstrapRedeemRequest {
  token: string;
}

export interface MeResponse {
  deviceId: string;
  isPlayer: boolean;
  settings: UserSettings;
  playerConflict: { otherDeviceId: string; lastHeartbeatAt: number } | null;
}

export interface PasskeySummary {
  id: number;
  nickname: string | null;
  transports: string[];
  lastUsedAt: number | null;
  createdAt: number;
}

export interface CreateSourceRequest {
  kind: SourceKind;
  name: string;
  config: SourceConfig;
  fetchMode?: FetchMode;
  cachePolicy?: CachePolicy;
  secrets?: unknown;
}

export interface UpdateSourceRequest {
  name?: string;
  config?: SourceConfig;
  fetchMode?: FetchMode;
  cachePolicy?: CachePolicy;
  secrets?: unknown;
}

export interface QobuzLoginRequest {
  sourceName: string;
  email: string;
  password: string;
}

export interface QobuzOAuthStartRequest {
  sourceName: string;
}

export interface QobuzOAuthStartResponse {
  state: string;
  authUrl: string;
}

export type QobuzOAuthStatusResponse =
  | { status: "pending" }
  | { status: "complete"; sourceId: number; email: string }
  | { status: "error"; error: string };

export interface CatalogUploadRequest {
  sourceId: number;
  tracks: Array<Omit<Track, "id">>;
  removedSourceTrackIds?: string[];
}

export interface ArtistListResponse {
  artists: Artist[];
}

export interface AlbumListResponse {
  albums: Album[];
}

export interface TrackListResponse {
  tracks: Track[];
}

export interface FileListResponse {
  entries: FileEntry[];
  path: string;
}

export interface SearchResponse extends SearchResult {
  fromQobuzLive: boolean;
}

export interface PlaylistListResponse {
  playlists: Playlist[];
}

export interface QueueResponse {
  entries: QueueEntry[];
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  nextCursor: number | null;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export interface ListSourcesResponse {
  sources: SourceInstance[];
}

export interface CreateSourceResponse {
  source: SourceInstance;
}

export interface PasskeyListResponse {
  passkeys: PasskeySummary[];
}

export interface SettingsResponse {
  settings: UserSettings;
}

export type { PlaylistWithTracks };
