// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { removedSourceTrackIds } from "../sources/tombstones.ts";

describe("removedSourceTrackIds", () => {
  test("returns existing source-track ids missing from the new scan", () => {
    expect(removedSourceTrackIds(["a.mp3", "b.flac", "c.opus"], ["b.flac"])).toEqual([
      "a.mp3",
      "c.opus",
    ]);
  });

  test("returns an empty list when all known tracks are still present", () => {
    expect(removedSourceTrackIds(["a.mp3"], ["a.mp3", "b.mp3"])).toEqual([]);
  });
});
