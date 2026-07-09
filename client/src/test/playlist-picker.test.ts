// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import type { Playlist } from "@jmmp/shared";
import { playlistPickerResults } from "src/playlists/picker";

describe("playlist picker results", () => {
  test("puts pinned playlists first and otherwise uses playlist ordering", () => {
    expect(
      playlistPickerResults([
        playlist("Zulu", 10),
        playlist("Beta"),
        playlist("Alpha"),
        playlist("Most recent pin", 20),
      ]).map((item) => item.name)
    ).toEqual(["Most recent pin", "Zulu", "Alpha", "Beta"]);
  });

  test("matches names case-insensitively and ignores surrounding whitespace", () => {
    expect(
      playlistPickerResults(
        [playlist("Late Night"), playlist("Morning Mix"), playlist("Night Drive")],
        "  NIGHT "
      ).map((item) => item.name)
    ).toEqual(["Late Night", "Night Drive"]);
  });

  test("excludes the current playlist before filtering", () => {
    expect(
      playlistPickerResults(
        [playlist("Current", null, 7), playlist("Another", null, 8)],
        "",
        7
      ).map((item) => item.id)
    ).toEqual([8]);
  });
});

function playlist(
  name: string,
  pinnedAt: number | null = null,
  id = name.length
): Playlist {
  return {
    id,
    name,
    createdAt: 0,
    updatedAt: 0,
    trackCount: 0,
    storage: { kind: "local", label: "jmmp server" },
    pinnedAt,
  };
}
