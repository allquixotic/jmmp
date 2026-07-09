// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  trackActionIds,
  updateOccurrenceSelection,
  updateTrackSelection,
} from "../tracks/selection";

describe("track selection", () => {
  const ids = [10, 11, 12, 13, 14];

  test("single click selects one track and sets the range anchor", () => {
    expect(updateTrackSelection(ids, [11, 12], 11, 13)).toEqual({
      selectedIds: [13],
      anchorId: 13,
    });
  });

  test("shift click selects the range from the anchor", () => {
    expect(
      updateTrackSelection(ids, [11], 11, 14, { range: true })
    ).toEqual({
      selectedIds: [11, 12, 13, 14],
      anchorId: 11,
    });
  });

  test("cmd or ctrl click toggles without disturbing order", () => {
    expect(
      updateTrackSelection(ids, [11, 13], 13, 12, { additive: true })
    ).toEqual({
      selectedIds: [11, 12, 13],
      anchorId: 12,
    });
    expect(
      updateTrackSelection(ids, [11, 12, 13], 12, 12, { additive: true })
    ).toEqual({
      selectedIds: [11, 13],
      anchorId: 12,
    });
  });

  test("row actions use the full selection only when the clicked row is selected", () => {
    expect(trackActionIds([11, 12, 13], 12)).toEqual([11, 12, 13]);
    expect(trackActionIds([11, 12, 13], 14)).toEqual([14]);
  });

  test("playlist selection keeps duplicate track occurrences distinct", () => {
    const first = { id: 7, occurrence: "first" };
    const duplicate = { id: 7, occurrence: "duplicate" };
    const other = { id: 8, occurrence: "other" };
    const ordered = [first, duplicate, other];

    expect(updateOccurrenceSelection(ordered, [], null, duplicate)).toEqual({
      selected: [duplicate],
      anchor: duplicate,
    });
    expect(
      updateOccurrenceSelection(ordered, [duplicate], duplicate, other, {
        range: true,
      })
    ).toEqual({
      selected: [duplicate, other],
      anchor: duplicate,
    });
  });
});
