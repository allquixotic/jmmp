// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  PlaybackWakeLock,
  type WakeLockDocumentLike,
  type WakeLockSentinelLike,
} from "../audio/wake-lock";

class FakeDocument implements WakeLockDocumentLike {
  visibilityState: WakeLockDocumentLike["visibilityState"] = "visible";
  private listeners = new Set<() => void>();

  addEventListener(type: "visibilitychange", listener: () => void): void {
    if (type === "visibilitychange") this.listeners.add(listener);
  }

  removeEventListener(type: "visibilitychange", listener: () => void): void {
    if (type === "visibilitychange") this.listeners.delete(listener);
  }

  setVisibility(visibilityState: WakeLockDocumentLike["visibilityState"]): void {
    this.visibilityState = visibilityState;
    for (const listener of this.listeners) listener();
  }
}

class FakeSentinel extends EventTarget implements WakeLockSentinelLike {
  releases = 0;

  async release(): Promise<void> {
    this.releases++;
    this.dispatchEvent(new Event("release"));
  }
}

describe("playback wake lock", () => {
  test("requests a screen wake lock while active and visible", async () => {
    const doc = new FakeDocument();
    const sentinel = new FakeSentinel();
    const requests: string[] = [];
    const wakeLock = new PlaybackWakeLock(doc, {
      wakeLock: {
        async request(type) {
          requests.push(type);
          return sentinel;
        },
      },
    });

    wakeLock.setActive(true);
    await flushMicrotasks();

    expect(requests).toEqual(["screen"]);
    expect(sentinel.releases).toBe(0);
  });

  test("releases on stop and reacquires after returning visible", async () => {
    const doc = new FakeDocument();
    const sentinels = [new FakeSentinel(), new FakeSentinel()];
    let nextSentinel = 0;
    const wakeLock = new PlaybackWakeLock(doc, {
      wakeLock: {
        async request() {
          return sentinels[nextSentinel++]!;
        },
      },
    });

    wakeLock.setActive(true);
    await flushMicrotasks();
    doc.setVisibility("hidden");
    await flushMicrotasks();
    doc.setVisibility("visible");
    await flushMicrotasks();
    wakeLock.setActive(false);

    expect(nextSentinel).toBe(2);
    expect(sentinels.map((sentinel) => sentinel.releases)).toEqual([1, 1]);
  });

  test("does nothing when the browser does not support wake locks", () => {
    const doc = new FakeDocument();
    const wakeLock = new PlaybackWakeLock(doc, {});

    wakeLock.setActive(true);
    doc.setVisibility("hidden");
    doc.setVisibility("visible");
    wakeLock.setActive(false);

    expect(doc.visibilityState).toBe("visible");
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
