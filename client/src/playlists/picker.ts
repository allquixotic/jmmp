// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Playlist } from "@jmmp/shared";
import { sortPlaylists } from "src/playlists/sort";

/**
 * Return the playlists that can be shown in a picker, using the same ordering
 * as the rest of jmmp. Filtering is intentionally name-only so the results
 * stay predictable when storage labels or metadata change.
 */
export function playlistPickerResults(
  playlists: Playlist[],
  query = "",
  excludedPlaylistId?: number | null
): Playlist[] {
  const needle = query.trim().toLocaleLowerCase();
  return sortPlaylists(
    playlists.filter(
      (playlist) =>
        playlist.id !== excludedPlaylistId &&
        (!needle || playlist.name.toLocaleLowerCase().includes(needle))
    )
  );
}
