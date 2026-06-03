// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import type { Track } from "@jmmp/shared";
import {
  installPlayerBackendForTest,
  usePlayerStore,
} from "../stores/player";
import { useSourcesStore } from "../stores/sources";

class FakePlayerBackend extends EventTarget {
  playCalls: Array<{ track: Track; options: unknown }> = [];
  params: unknown[] = [];

  async play(track: Track, options?: unknown): Promise<void> {
    this.playCalls.push({ track, options });
  }

  pause(): void {}
  resume(): void {}
  stop(): void {}
  async seek(): Promise<void> {}
  setParams(params: unknown): void {
    this.params.push(params);
  }
  setVolume(): void {}
}

let restorePlayer: (() => void) | null = null;

afterEach(() => {
  restorePlayer?.();
  restorePlayer = null;
});

describe("player store", () => {
  test("starting any track immediately resets the displayed position", async () => {
    setActivePinia(createPinia());
    const fake = new FakePlayerBackend();
    restorePlayer = installPlayerBackendForTest(fake);

    const sources = useSourcesStore();
    sources.loaded = true;
    sources.sources = [
      {
        id: 1,
        kind: "s3",
        name: "S3",
        config: {
          kind: "s3",
          endpoint: "https://example.invalid",
          region: "us-east-1",
          bucket: "music",
        },
        fetchMode: "auto",
        cachePolicy: "none",
        lastScannedAt: null,
        createdAt: 0,
      },
    ];

    const player = usePlayerStore();
    player.position = 73;
    player.duration = 180;
    player.current = { ...track, id: 99, title: "Old" };

    await player.play(track);

    expect(player.current?.id).toBe(track.id);
    expect(player.position).toBe(0);
    expect(player.duration).toBe(120);
    expect(fake.playCalls[0]?.track.id).toBe(track.id);
  });
});

const track: Track = {
  id: 7,
  sourceId: 1,
  sourceTrackId: "song.mp3",
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationMs: 120_000,
  codec: "mp3",
};
