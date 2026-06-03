// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { SourceKind, Track } from "./source.ts";

export type PlaylistStorageKind = "local" | "source" | "hybrid";

export interface PlaylistStorage {
  kind: PlaylistStorageKind;
  label: string;
  sourceId?: number;
  sourceName?: string;
  sourceKind?: SourceKind;
  sourcePlaylistId?: string;
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  trackCount: number;
  storage: PlaylistStorage;
  pinnedAt: number | null;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

export interface QueueEntry {
  position: number;
  track: Track;
  addedAt: number;
}

export interface HistoryEntry {
  id: number;
  track: Track;
  playedAt: number;
  playedToCompletion: boolean;
}
