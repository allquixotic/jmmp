// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, spyOn, test, mock } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import type { Track } from "@jmmp/shared";
import {
  installPlaybackWakeLockForTest,
  installPlayerBackendForTest,
  usePlayerStore,
} from "../stores/player";
import { useSourcesStore } from "../stores/sources";
import { useSessionStore } from "../stores/session";
import { DEFAULT_USER_SETTINGS } from "@jmmp/shared";
import { tabLock } from "../tabs/tab-lock";
import { useQueueStore } from "../stores/queue";
import { UnavailableTrackError } from "../audio/playback-error";
import type { PlayerState } from "../audio/pipeline";

class FakePlayerBackend extends EventTarget {
  playCalls: Array<{ track: Track; options: unknown }> = [];
  params: unknown[] = [];
  pauseCalls = 0;
  resumeCalls = 0;

  async play(track: Track, options?: unknown): Promise<void> {
    this.playCalls.push({ track, options });
  }

  pause(): void {
    this.pauseCalls += 1;
  }
  resume(): void {
    this.resumeCalls += 1;
  }
  stop(): void {}
  async seek(): Promise<void> {}
  setParams(params: unknown): void {
    this.params.push(params);
  }
  setVolume(): void {}

  emitState(state: PlayerState): void {
    this.dispatchEvent(new CustomEvent("state", { detail: state }));
  }
}

class FakeWakeLockController {
  activeStates: boolean[] = [];

  setActive(active: boolean): void {
    this.activeStates.push(active);
  }
}

let restorePlayer: (() => void) | null = null;
let restoreWakeLock: (() => void) | null = null;

afterEach(() => {
  mock.restore();
  restorePlayer?.();
  restorePlayer = null;
  restoreWakeLock?.();
  restoreWakeLock = null;
});

describe("player store", () => {
  test("V25 rejected playback startup becomes a visible, retryable error", async () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.hasFullSession = true;
    session.me = { deviceId: "test", passkeyId: 1, role: "admin", moqEnabled: false, streamUrl: null, isPlayer: true, playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
    spyOn(tabLock, "takeControl").mockResolvedValue(undefined);
    const fake = new FakePlayerBackend();
    restorePlayer = installPlayerBackendForTest(fake);
    const sources = useSourcesStore(); sources.loaded = true; sources.sources = [];
    const failure = spyOn(fake, "play").mockRejectedValue(new Error("Spotify source unavailable"));
    const player = usePlayerStore();
    try {
      await player.play(track);
      expect(player.state).toBe("error");
      expect(player.error).toContain("Spotify source unavailable");
      expect(player.error).toContain("Error:");
      expect(player.current?.id).toBe(track.id);
      failure.mockResolvedValue();
      await player.toggle();
      expect(failure).toHaveBeenCalledTimes(2);
      expect(player.error).toBeNull();
    } finally { failure.mockRestore(); }
  });
  test("starting any track immediately resets the displayed position", async () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.hasFullSession = true;
    session.me = { deviceId: "test", passkeyId: 1, role: "admin", moqEnabled: false, streamUrl: null, isPlayer: true, playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
    spyOn(tabLock, "takeControl").mockResolvedValue(undefined);
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

  test("holds the playback wake lock only while playing", () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.hasFullSession = true;
    session.me = { deviceId: "test", passkeyId: 1, role: "admin", moqEnabled: false, streamUrl: null, isPlayer: true, playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
    spyOn(tabLock, "takeControl").mockResolvedValue(undefined);
    const fake = new FakePlayerBackend();
    const wakeLock = new FakeWakeLockController();
    restorePlayer = installPlayerBackendForTest(fake);
    restoreWakeLock = installPlaybackWakeLockForTest(wakeLock);

    usePlayerStore().ensure();
    fake.emitState("loading");
    fake.emitState("playing");
    fake.emitState("paused");
    fake.emitState("playing");
    fake.emitState("ended");
    fake.emitState("error");

    expect(wakeLock.activeStates).toEqual([false, true, false, true, false, false]);
  });

  test("toggle pauses and resumes an active current track", async () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.hasFullSession = true;
    session.me = { deviceId: "test", passkeyId: 1, role: "admin", moqEnabled: false, streamUrl: null, isPlayer: true, playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
    spyOn(tabLock, "takeControl").mockResolvedValue(undefined);
    const fake = new FakePlayerBackend();
    restorePlayer = installPlayerBackendForTest(fake);
    const player = usePlayerStore();
    player.current = track;

    player.state = "playing";
    await player.toggle();
    expect(fake.pauseCalls).toBe(1);
    expect(fake.resumeCalls).toBe(0);

    player.state = "paused";
    await player.toggle();
    expect(fake.pauseCalls).toBe(1);
    expect(fake.resumeCalls).toBe(1);
  });

  test("toggle replays the current track after playback ends or errors", async () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.hasFullSession = true;
    session.me = { deviceId: "test", passkeyId: 1, role: "admin", moqEnabled: false, streamUrl: null, isPlayer: true, playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
    spyOn(tabLock, "takeControl").mockResolvedValue(undefined);
    const fake = new FakePlayerBackend();
    restorePlayer = installPlayerBackendForTest(fake);
    const sources = useSourcesStore();
    sources.loaded = true;
    sources.sources = [];
    const player = usePlayerStore();
    player.current = track;

    player.state = "ended";
    await player.toggle();
    player.state = "error";
    await player.toggle();

    expect(fake.playCalls.map(({ track: played }) => played.id)).toEqual([
      track.id,
      track.id,
    ]);
  });

  test("toggle is inert without a current track or while loading", async () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.hasFullSession = true;
    session.me = { deviceId: "test", passkeyId: 1, role: "admin", moqEnabled: false, streamUrl: null, isPlayer: true, playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
    spyOn(tabLock, "takeControl").mockResolvedValue(undefined);
    const fake = new FakePlayerBackend();
    restorePlayer = installPlayerBackendForTest(fake);
    const player = usePlayerStore();

    player.state = "idle";
    await player.toggle();
    player.current = track;
    player.state = "loading";
    await player.toggle();

    expect(fake.playCalls).toHaveLength(0);
    expect(fake.pauseCalls).toBe(0);
    expect(fake.resumeCalls).toBe(0);
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


describe("V28 Spotify unavailable skipping", () => {
  function setup(ids: number[]) {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.hasFullSession = true;
    session.me = { deviceId: "test", passkeyId: 1, role: "admin", moqEnabled: false, streamUrl: null, isPlayer: true, playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
    spyOn(tabLock, "takeControl").mockResolvedValue(undefined);
    const fake = new FakePlayerBackend();
    restorePlayer = installPlayerBackendForTest(fake);
    useSourcesStore().loaded = true;
    const queue = useQueueStore();
    queue.entries = ids.map((id, position) => ({ position, addedAt: 0, track: { ...track, id } }));
    queue.index = 0;
    return { fake, queue, player: usePlayerStore() };
  }
  test("typed unavailable startup skips consecutive failures and preserves full stacks", async () => {
    const { fake, player, queue } = setup([7, 8, 9]);
    const start = spyOn(fake, "play").mockImplementation(async track => {
      if (track.id !== 9) throw new UnavailableTrackError("unavailable", `SpotifySourceError: unavailable\n    at fetch(worker.ts:21)`);
    });
    try {
      await player.play(track);
      expect(start.mock.calls.map(call => call[0].id)).toEqual([7, 8, 9]);
      expect(queue.index).toBe(2);
      expect(player.diagnostics).toHaveLength(2);
      expect(player.diagnostics[0]?.error).toContain("at fetch(worker.ts:21)");
      expect(player.error).toBeNull();
    } finally { start.mockRestore(); }
  });
  test("asynchronous unavailable status advances once, ignores stale tracks and stops at queue end", async () => {
    const { fake, player, queue } = setup([7, 8]);
    await player.play(track);
    const event = (id: number) => fake.dispatchEvent(new CustomEvent("unavailable", { detail: { trackId: id, error: "stack" } }));
    event(7); event(7);
    await Bun.sleep(5);
    expect(queue.index).toBe(1);
    expect(fake.playCalls.map(call => call.track.id)).toEqual([7, 8]);
    event(8); event(8);
    await Bun.sleep(5);
    expect(player.state).toBe("error");
    expect(player.error).toBe("stack");
    expect(player.diagnostics).toHaveLength(2);
    expect(fake.playCalls).toHaveLength(2);
  });
  test("auth/network/decoder failures are retryable and never skip", async () => {
    const { fake, player, queue } = setup([7, 8]);
    const start = spyOn(fake, "play").mockRejectedValue(new Error("Spotify login failed"));
    try {
      await player.play(track);
      expect(queue.index).toBe(0);
      expect(player.state).toBe("error");
      expect(player.diagnostics).toHaveLength(0);
    } finally { start.mockRestore(); }
  });
});
