// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Track } from "@jmmp/shared";

export type TrackColumnKey =
  | "artist"
  | "album"
  | "source"
  | "duration"
  | "codec"
  | "quality";

export type TrackSortKey = "title" | TrackColumnKey;
export type SortDirection = "asc" | "desc";

export const DEFAULT_PLAYLIST_COLUMNS: TrackColumnKey[] = [
  "artist",
  "album",
  "source",
  "duration",
];
export const DEFAULT_SEARCH_COLUMNS: TrackColumnKey[] = [
  "artist",
  "album",
  "source",
  "duration",
];

export function sortTracksByColumn(
  tracks: Track[],
  key: TrackSortKey,
  direction: SortDirection,
  sourceName: (sourceId: number) => string = (sourceId) => String(sourceId)
): Track[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...tracks].sort((a, b) => sign * compareTracks(a, b, key, sourceName));
}

export function compareTracks(
  a: Track,
  b: Track,
  key: TrackSortKey,
  sourceName: (sourceId: number) => string = (sourceId) => String(sourceId)
): number {
  if (key === "duration") {
    return compareNumbers(a.durationMs, b.durationMs) || compareText(a.title, b.title);
  }
  if (key === "quality") {
    return (
      compareNumbers(a.sampleRate ?? 0, b.sampleRate ?? 0) ||
      compareNumbers(a.bitDepth ?? 0, b.bitDepth ?? 0) ||
      compareNumbers(a.channels ?? 0, b.channels ?? 0) ||
      compareText(a.title, b.title)
    );
  }
  return compareText(trackSortText(a, key, sourceName), trackSortText(b, key, sourceName));
}

export function trackSortText(
  track: Track,
  key: Exclude<TrackSortKey, "duration" | "quality">,
  sourceName: (sourceId: number) => string = (sourceId) => String(sourceId)
): string {
  if (key === "artist") return track.artist || track.albumArtist || "";
  if (key === "album") return track.album || "";
  if (key === "source") return sourceName(track.sourceId);
  if (key === "codec") return track.codec || "";
  return track.title || "";
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a - b;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}
