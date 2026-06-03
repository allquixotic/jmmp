// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { estimateByteOffset, planSeek } from "../audio/seek.ts";
import type { Track } from "@jmmp/shared";

const baseTrack: Track = {
  id: 1,
  sourceId: 1,
  sourceTrackId: "k",
  title: "",
  artist: "",
  album: "",
  durationMs: 120_000,
  codec: "mp3",
  fileSize: 4_800_000,
};

describe("estimateByteOffset", () => {
  test("at start", () => {
    const r = estimateByteOffset(baseTrack, 0)!;
    expect(r.byteOffset).toBe(0);
  });
  test("at midpoint approximately half the bytes", () => {
    const r = estimateByteOffset(baseTrack, 60)!;
    expect(r.byteOffset).toBeGreaterThan(2_300_000);
    expect(r.byteOffset).toBeLessThan(2_400_001);
  });
  test("clamps above duration", () => {
    const r = estimateByteOffset(baseTrack, 9999)!;
    expect(r.byteOffset).toBeGreaterThan(4_700_000);
  });
  test("null when sizing info missing", () => {
    expect(
      estimateByteOffset({ ...baseTrack, fileSize: undefined }, 30)
    ).toBeNull();
    expect(
      estimateByteOffset({ ...baseTrack, durationMs: 0 }, 30)
    ).toBeNull();
  });
  test("flac needs resync", () => {
    const r = estimateByteOffset({ ...baseTrack, codec: "flac" }, 30)!;
    expect(r.needsResync).toBe(true);
  });
  test("seek plan uses byte range when sizing info exists", () => {
    expect(planSeek(baseTrack, 60)).toEqual({
      startByte: 2_395_904,
      offsetSeconds: 60,
      discardSeconds: 0,
      estimated: true,
    });
  });
  test("seek plan falls back to restart-and-discard without sizing info", () => {
    expect(planSeek({ ...baseTrack, fileSize: undefined }, 12)).toEqual({
      startByte: 0,
      offsetSeconds: 12,
      discardSeconds: 12,
      estimated: false,
    });
  });
});
