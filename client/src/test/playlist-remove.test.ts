// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { removePlaylistOccurrences } from "src/playlists/remove";

describe("playlist occurrence removal", () => {
  test("removes only the selected occurrence when duplicate IDs exist", () => {
    const first = { id: 7, occurrence: "first" };
    const duplicate = { id: 7, occurrence: "duplicate" };
    const other = { id: 8, occurrence: "other" };

    expect(removePlaylistOccurrences([first, duplicate, other], [first])).toEqual([
      duplicate,
      other,
    ]);
  });

  test("preserves the playlist's manual order when selection came from a sorted view", () => {
    const manualFirst = { id: 3, title: "Zulu" };
    const manualSecond = { id: 1, title: "Alpha" };
    const manualThird = { id: 2, title: "Mike" };
    const sortedSelection = [manualThird, manualFirst];

    expect(
      removePlaylistOccurrences(
        [manualFirst, manualSecond, manualThird],
        sortedSelection
      )
    ).toEqual([manualSecond]);
  });
});
