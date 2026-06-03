// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import type { Track } from "@jmmp/shared";
import { sortTracksByColumn } from "src/tracks/sort";

describe("track column sorting", () => {
  test("sorts by quality without mutating manual order", () => {
    const tracks = [
      track(1, "CD", 44_100, 16),
      track(2, "Hi-res", 96_000, 24),
      track(3, "Low", 22_050, 16),
    ];

    expect(sortTracksByColumn(tracks, "quality", "desc").map((t) => t.title))
      .toEqual(["Hi-res", "CD", "Low"]);
    expect(tracks.map((t) => t.title)).toEqual(["CD", "Hi-res", "Low"]);
  });
});

function track(
  id: number,
  title: string,
  sampleRate: number,
  bitDepth: number
): Track {
  return {
    id,
    sourceId: 1,
    sourceTrackId: String(id),
    title,
    artist: "",
    album: "",
    durationMs: 0,
    codec: "flac",
    sampleRate,
    bitDepth,
  };
}
