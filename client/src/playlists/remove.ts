// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

/**
 * Remove the exact rendered occurrences selected by the user. Track IDs are
 * intentionally not used here because a playlist may contain the same track
 * more than once.
 */
export function removePlaylistOccurrences<T>(
  playlistItems: T[],
  occurrencesToRemove: T[]
): T[] {
  const removed = new Set(occurrencesToRemove);
  return playlistItems.filter((item) => !removed.has(item));
}
