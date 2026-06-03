// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { DecodedChunk } from "./decoders";

export function* sliceDecodedChunk(
  chunk: DecodedChunk,
  maxFrames: number,
): Generator<DecodedChunk> {
  if (maxFrames <= 0) throw new Error("maxFrames must be positive");
  const channelFrames = chunk.channels.reduce(
    (min, channel) => Math.min(min, channel.length),
    chunk.samplesDecoded,
  );
  const totalFrames = Math.max(0, Math.min(chunk.samplesDecoded, channelFrames));
  for (let offset = 0; offset < totalFrames; offset += maxFrames) {
    const end = Math.min(totalFrames, offset + maxFrames);
    yield {
      ...chunk,
      samplesDecoded: end - offset,
      channels: chunk.channels.map((channel) => channel.subarray(offset, end)),
    };
  }
}

export function cloneChannels(channels: Float32Array[]): Float32Array[] {
  return channels.map((channel) => {
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    return copy;
  });
}
