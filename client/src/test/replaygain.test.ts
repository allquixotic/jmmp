// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { computeGainDb } from "../audio/replaygain.ts";
import type { Track } from "@jmmp/shared";

function track(rg: { track?: number; album?: number }): Track {
  return {
    id: 1,
    sourceId: 1,
    sourceTrackId: "a",
    title: "t",
    artist: "a",
    album: "x",
    durationMs: 0,
    codec: "mp3",
    ...(rg.track !== undefined ? { rgTrackDb: rg.track } : {}),
    ...(rg.album !== undefined ? { rgAlbumDb: rg.album } : {}),
  };
}

describe("computeGainDb", () => {
  test("off mode returns 0", () => {
    expect(computeGainDb(track({ track: -7 }), "off", 0)).toBe(0);
  });
  test("track mode uses track gain", () => {
    expect(computeGainDb(track({ track: -7 }), "track", 0)).toBe(-7);
  });
  test("album mode uses album gain", () => {
    expect(computeGainDb(track({ album: -5 }), "album", 0)).toBe(-5);
  });
  test("album-fallback prefers album, falls back to track", () => {
    expect(computeGainDb(track({ track: -3 }), "album-fallback-track", 0)).toBe(-3);
    expect(
      computeGainDb(track({ track: -3, album: -2 }), "album-fallback-track", 0)
    ).toBe(-2);
  });
  test("preamp is additive", () => {
    expect(computeGainDb(track({ track: -7 }), "track", 3)).toBe(-4);
  });
  test("missing tags yield 0", () => {
    expect(computeGainDb(track({}), "album-fallback-track", 0)).toBe(0);
  });
});
