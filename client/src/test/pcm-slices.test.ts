// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

import { cloneChannels, sliceDecodedChunk } from "../audio/pcm-slices";
import type { DecodedChunk } from "../audio/decoders";

function chunk(frames: number): DecodedChunk {
  return {
    sampleRate: 96_000,
    samplesDecoded: frames,
    channels: [
      Float32Array.from({ length: frames }, (_v, i) => i),
      Float32Array.from({ length: frames }, (_v, i) => i + 1000),
    ],
  };
}

describe("sliceDecodedChunk", () => {
  test("splits large decoder output into bounded worklet pushes", () => {
    const slices = [...sliceDecodedChunk(chunk(50_000), 16_384)];

    expect(slices.map((slice) => slice.samplesDecoded)).toEqual([
      16_384,
      16_384,
      16_384,
      848,
    ]);
    expect(slices[1]!.channels[0]![0]).toBe(16_384);
    expect(slices[3]!.channels[1]![0]).toBe(50_152);
  });

  test("clamps to the shortest channel", () => {
    const source = chunk(10);
    source.channels[1] = source.channels[1]!.subarray(0, 6);

    const slices = [...sliceDecodedChunk(source, 4)];

    expect(slices.map((slice) => slice.samplesDecoded)).toEqual([4, 2]);
  });
});

describe("cloneChannels", () => {
  test("copies channel data before transferring to the worklet", () => {
    const source = [Float32Array.from([1, 2, 3])];
    const cloned = cloneChannels(source);

    source[0]![0] = 9;

    expect([...cloned[0]!]).toEqual([1, 2, 3]);
  });
});
