// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { codecFromExtension, codecFromMime } from "@jmmp/shared";

describe("codecFromExtension", () => {
  test("mp3", () => expect(codecFromExtension("song.mp3")).toBe("mp3"));
  test("flac", () => expect(codecFromExtension("song.flac")).toBe("flac"));
  test("ogg", () => expect(codecFromExtension("song.ogg")).toBe("vorbis"));
  test("opus", () => expect(codecFromExtension("song.opus")).toBe("opus"));
  test("unknown", () => expect(codecFromExtension("song.aac")).toBeNull());
  test("upper case", () => expect(codecFromExtension("X.FLAC")).toBe("flac"));
});

describe("codecFromMime", () => {
  test("audio/mpeg", () => expect(codecFromMime("audio/mpeg")).toBe("mp3"));
  test("audio/flac", () => expect(codecFromMime("audio/flac")).toBe("flac"));
  test("audio/opus", () => expect(codecFromMime("audio/opus")).toBe("opus"));
  test("audio/ogg => vorbis", () => expect(codecFromMime("audio/ogg")).toBe("vorbis"));
});
