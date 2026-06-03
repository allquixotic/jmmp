// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import type { Playlist } from "@jmmp/shared";
import { sortPlaylists } from "src/playlists/sort";

describe("playlist sorting", () => {
  test("sorts punctuation playlists above letter and number playlists", () => {
    expect(
      sortPlaylists([
        playlist("Beta"),
        playlist("10s"),
        playlist("! Rush"),
        playlist("# Scratch"),
        playlist("Alpha"),
      ]).map((playlist) => playlist.name)
    ).toEqual(["! Rush", "# Scratch", "10s", "Alpha", "Beta"]);
  });

  test("pinned playlists float above unpinned", () => {
    expect(
      sortPlaylists([
        playlist("Alpha"),
        playlist("Beta", 100),
        playlist("Charlie"),
        playlist("! Punctuation"),
      ]).map((p) => p.name)
    ).toEqual(["Beta", "! Punctuation", "Alpha", "Charlie"]);
  });

  test("among pinned, most-recently pinned comes first", () => {
    expect(
      sortPlaylists([
        playlist("Older", 100),
        playlist("Newer", 500),
        playlist("Middle", 300),
        playlist("Unpinned"),
      ]).map((p) => p.name)
    ).toEqual(["Newer", "Middle", "Older", "Unpinned"]);
  });
});

function playlist(name: string, pinnedAt: number | null = null): Playlist {
  return {
    id: name.length,
    name,
    createdAt: 0,
    updatedAt: 0,
    trackCount: 0,
    storage: { kind: "local", label: "jmmp server" },
    pinnedAt,
  };
}
