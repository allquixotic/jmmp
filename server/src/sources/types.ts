// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type {
  ByteRange,
  ScanEvent,
  SearchResult,
  SourceConfig,
  SourceSecrets,
} from "@jmmp/shared";

export interface ScanContext {
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
}

export interface UpstreamFetchResult {
  body: ReadableStream<Uint8Array>;
  status: number;
  headers: Headers;
}

export interface ServerSourceAdapter {
  scan(ctx: ScanContext): AsyncIterable<ScanEvent>;
  fetch(sourceTrackId: string, range?: ByteRange): Promise<UpstreamFetchResult>;
  search?(query: string, limit: number): Promise<SearchResult>;
  createPlaylist?(name: string): Promise<string>;
  syncPlaylistOrder?(
    sourcePlaylistId: string,
    orderedSourceTrackIds: string[]
  ): Promise<void>;
  syncPlaylistTracks?(
    sourcePlaylistId: string,
    orderedSourceTrackIds: string[]
  ): Promise<void>;
}

export interface AdapterInit {
  sourceId: number;
  config: SourceConfig;
  secrets: SourceSecrets;
}
