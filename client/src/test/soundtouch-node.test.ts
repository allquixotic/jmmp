// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { WorkletBufferTracker } from "../audio/soundtouch-node";

describe("WorkletBufferTracker", () => {
  test("keeps in-flight PCM in the buffer estimate when reports are stale", () => {
    const tracker = new WorkletBufferTracker();
    const first = tracker.enqueue(64_000);
    const second = tracker.enqueue(64_000);

    expect(first).toEqual({ epoch: 0, seq: 1 });
    expect(second).toEqual({ epoch: 0, seq: 2 });
    expect(tracker.bufferedFrames).toBe(128_000);

    tracker.acknowledge({ epoch: 0, ackSeq: 1, frames: 8_000 });

    expect(tracker.bufferedFrames).toBe(72_000);

    tracker.acknowledge({ epoch: 0, ackSeq: 2, frames: 70_000 });

    expect(tracker.bufferedFrames).toBe(70_000);
  });

  test("ignores buffered reports from an earlier playback epoch", () => {
    const tracker = new WorkletBufferTracker();
    tracker.enqueue(64_000);
    const epoch = tracker.reset();
    tracker.enqueue(32_000);

    expect(epoch).toBe(1);
    expect(tracker.acknowledge({ epoch: 0, ackSeq: 1, frames: 0 })).toBe(false);
    expect(tracker.bufferedFrames).toBe(32_000);
  });
});
