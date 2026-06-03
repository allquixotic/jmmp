// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { moveItem } from "../playlists/reorder";

describe("playlist row reordering", () => {
  test("moves an item from one index to another", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  test("returns a copy unchanged for invalid moves", () => {
    const items = ["a", "b", "c"];
    const next = moveItem(items, -1, 2);
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
  });
});
