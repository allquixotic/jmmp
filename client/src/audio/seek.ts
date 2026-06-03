// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Codec, Track } from "@jmmp/shared";

export interface SeekEstimate {
  byteOffset: number;
  needsResync: boolean;
}

export interface SeekPlan {
  startByte: number;
  offsetSeconds: number;
  discardSeconds: number;
  estimated: boolean;
}

// Estimate byte offset for a target time within a track. Used to issue an
// HTTP Range request when the user seeks. The decoder may need to resync to
// the next codec frame after the byte offset.

export function estimateByteOffset(
  track: Track,
  targetSeconds: number
): SeekEstimate | null {
  if (!track.fileSize || !track.durationMs || track.durationMs === 0) return null;
  const ratio = Math.max(0, Math.min(1, targetSeconds / (track.durationMs / 1000)));
  // ~3% backstep so the decoder can find the next frame header.
  const off = Math.max(0, Math.floor(track.fileSize * ratio - 4096));
  return { byteOffset: off, needsResync: track.codec !== "mp3" };
}

export function planSeek(track: Track, targetSeconds: number): SeekPlan {
  const durationSeconds = track.durationMs > 0 ? track.durationMs / 1000 : 0;
  const target = durationSeconds
    ? Math.max(0, Math.min(durationSeconds, targetSeconds))
    : Math.max(0, targetSeconds);
  const estimate = estimateByteOffset(track, target);
  if (estimate) {
    return {
      startByte: estimate.byteOffset,
      offsetSeconds: target,
      discardSeconds: 0,
      estimated: true,
    };
  }
  return {
    startByte: 0,
    offsetSeconds: target,
    discardSeconds: target,
    estimated: false,
  };
}

// Per-codec finer estimates can read STREAMINFO / Ogg granules / Xing tables
// to give exact frame boundaries. Stubs below — initial release uses the
// linear estimate above.

export async function flacSeekFromStreaminfo(
  _bytes: Uint8Array,
  _targetSeconds: number
): Promise<SeekEstimate | null> {
  return null;
}

export async function oggSeekByGranule(
  _stream: ReadableStream<Uint8Array>,
  _codec: Codec,
  _targetSeconds: number
): Promise<SeekEstimate | null> {
  return null;
}

export async function mp3SeekFromXing(
  _bytes: Uint8Array,
  _targetSeconds: number
): Promise<SeekEstimate | null> {
  return null;
}
