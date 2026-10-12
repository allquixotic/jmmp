// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { DEFAULT_DSP_PARAMS, type PlaybackStatus } from "@jmmp/shared";
import { MoqPlayer } from "../audio/moq";
import { BackgroundPlayout } from "../audio/background-playout";

test("V28 MoQ unavailable events are typed, deduplicated and private to controllers", () => {
  const status: PlaybackStatus = { instanceId: "one", revision: 1, generation: 1, trackId: 7,
    position: 0, duration: 100, state: "error", params: DEFAULT_DSP_PARAMS, error: "full stack", errorCode: "spotify_unavailable" };
  for (const publicListener of [false, true]) {
    const backend = new MoqPlayer(publicListener);
    const apply = (value: PlaybackStatus) => (backend as unknown as { apply(s: PlaybackStatus): void }).apply(value);
    const errors: unknown[] = [], skipped: unknown[] = [];
    backend.addEventListener("error", e => errors.push((e as CustomEvent).detail));
    backend.addEventListener("unavailable", e => skipped.push((e as CustomEvent).detail));
    apply(status); apply(status);
    apply({ ...status, revision: 0, generation: 0 });
    const network = { ...status, revision: 2, generation: 2, error: "network" };
    delete network.errorCode; apply(network);
    expect(errors).toEqual(["full stack", "network"]);
    expect(skipped).toEqual(publicListener ? [] : [{ trackId: 7, error: "full stack" }]);
  }
});

test("V31 listeners rearm once for new generations, even when the track ID is unchanged", () => {
  const backend = new MoqPlayer(true);
  const internals = backend as unknown as { apply(s: PlaybackStatus): void; restartMedia(): void };
  let restarts = 0;
  internals.restartMedia = () => { restarts++; };
  const status: PlaybackStatus = { instanceId: "one", revision: 1, generation: 1, trackId: null,
    position: 0, duration: 100, state: "playing", params: DEFAULT_DSP_PARAMS, error: null };
  internals.apply(status);
  internals.apply({ ...status, revision: 2, generation: 2, state: "buffering" });
  internals.apply({ ...status, revision: 3, generation: 2 });
  internals.apply(status); // An older poll must not replace the current pipeline.
  expect(restarts).toBe(1);
  internals.apply({ ...status, revision: 4, generation: 3, state: "idle" });
  internals.apply({ ...status, revision: 5, generation: 4, state: "buffering" });
  expect(restarts).toBe(3);
  backend.dispose();
});

test("V31 recovered broadcast clears its current error without losing the original diagnostic event", () => {
  const backend = new MoqPlayer(true);
  const internals = backend as unknown as { apply(s: PlaybackStatus): void };
  const errors: unknown[] = [];
  backend.addEventListener("error", e => errors.push((e as CustomEvent).detail));
  const status: PlaybackStatus = { instanceId: "one", revision: 1, generation: 1, trackId: null,
    position: 0, duration: 100, state: "error", params: DEFAULT_DSP_PARAMS, error: "SourceError: failed\n    at fetch(source.ts:1:1)" };
  internals.apply(status);
  internals.apply({ ...status, revision: 2, generation: 2, state: "buffering", error: null });
  expect(errors).toEqual([status.error, null]);
  backend.dispose();
});

test("V32 a stopped render playhead adapts even when the ring reports no stall; boundaries cancel it", async () => {
  const backend = new MoqPlayer(true);
  const internals = backend as unknown as {
    watch: unknown; netModule: unknown; delay: unknown; lastStatus: PlaybackStatus;
    heardAudio: boolean; mediaProgressAt: number; refillUntil: number;
    latency: { targetMs: number; underruns: number }; monitorMedia(): void; resetMonitoring(): void;
  };
  let contextState = "running", timestamp = 100;
  internals.watch = { audio: { out: { context: { peek: () => ({ state: contextState }) }, stalled: { peek: () => false }, timestamp: { peek: () => timestamp } } },
    sync: { out: { delay: { peek: () => 100 } } }, close() {} };
  internals.netModule = { Time: { Milli: (value: number) => value } };
  let requested = 100;
  internals.delay = { peek: () => requested, set: (value: number) => { requested = value; } };
  internals.lastStatus = { instanceId: "one", revision: 1, generation: 1, trackId: null,
    position: 0, duration: 100, state: "playing", params: DEFAULT_DSP_PARAMS, error: null };
  function gap() { internals.heardAudio = true; internals.mediaProgressAt = performance.now() - 1000; internals.refillUntil = 0; }
  try {
    gap(); internals.monitorMedia();
    await Bun.sleep(550);
    expect(internals.latency.underruns).toBe(1);
    // Late main-thread signal delivery with a healthy audio clock must not
    // inflate delay: the worklet has actually rendered the intervening time.
    gap(); const previous = timestamp, observedAt = internals.mediaProgressAt;
    internals.monitorMedia();
    await Bun.sleep(450); timestamp = previous + performance.now() - observedAt;
    await Bun.sleep(100);
    expect(internals.latency.underruns).toBe(1);
    expect(internals.latency.targetMs).toBeGreaterThan(100);
    gap(); internals.monitorMedia(); internals.resetMonitoring();
    await Bun.sleep(550);
    expect(internals.latency.underruns).toBe(1);
    for (const state of ["paused", "idle", "ended", "buffering"] as const) {
      internals.lastStatus.state = state; gap(); internals.monitorMedia();
    }
    internals.lastStatus.state = "playing"; contextState = "suspended"; gap(); internals.monitorMedia();
    await Bun.sleep(550);
    expect(internals.latency.underruns).toBe(1);
  } finally { backend.dispose(); }
});

test("V34 one continuous stall raises once and triggers full receiver recovery instead of endless rearming", async () => {
  const backend = new MoqPlayer(true);
  const internals = backend as unknown as {
    watch: unknown; netModule: unknown; delay: unknown; lastStatus: PlaybackStatus;
    heardAudio: boolean; mediaProgressAt: number; refillUntil: number;
    latency: { targetMs: number; underruns: number }; monitorMedia(): void; reconnect(): void;
  };
  internals.watch = { audio: { out: { context: { peek: () => ({ state: "running" }) }, stalled: { peek: () => false }, timestamp: { peek: () => 100 } } },
    sync: { out: { delay: { peek: () => 100 } } }, close() {} };
  internals.netModule = { Time: { Milli: (value: number) => value } };
  let requested = 100, recoveries = 0;
  internals.delay = { peek: () => requested, set: (value: number) => { requested = value; } };
  internals.reconnect = () => { recoveries++; };
  internals.lastStatus = { instanceId: "one", revision: 1, generation: 1, trackId: null,
    position: 0, duration: 100, state: "playing", params: DEFAULT_DSP_PARAMS, error: null };
  internals.heardAudio = true; internals.mediaProgressAt = performance.now() - 1000; internals.refillUntil = 0;
  try {
    internals.monitorMedia(); await Bun.sleep(550);
    const learned = internals.latency.targetMs;
    expect(internals.latency.underruns).toBe(1);
    internals.refillUntil = 0;
    for (let i = 0; i < 10; i++) internals.monitorMedia();
    await Bun.sleep(550);
    expect(internals.latency.underruns).toBe(1);
    expect(internals.latency.targetMs).toBe(learned);
    internals.mediaProgressAt = performance.now() - 9000; internals.monitorMedia();
    expect(recoveries).toBe(1);
    for (const state of ["paused", "idle", "ended", "buffering"] as const) {
      internals.lastStatus.state = state; internals.monitorMedia();
    }
    expect(recoveries).toBe(1);
  } finally { backend.dispose(); }
});

test("V43/V44 local listener pause survives status polls; hidden playheads neither learn nor reconnect", async () => {
  const backend = new MoqPlayer(true);
  const internals = backend as unknown as {
    watch: unknown; netModule: unknown; delay: unknown; paused: unknown; lastStatus: PlaybackStatus;
    heardAudio: boolean; mediaProgressAt: number; refillUntil: number; background: BackgroundPlayout;
    latency: { targetMs: number; underruns: number }; monitorMedia(): void; reconnect(): void; apply(status: PlaybackStatus): void;
  };
  let requested = 100, paused = false, recoveries = 0, resumes = 0;
  internals.watch = { audio: { out: { context: { peek: () => ({ state: "running", resume: async () => { resumes++; } }) }, stalled: { peek: () => false }, timestamp: { peek: () => 100 } } },
    sync: { out: { delay: { peek: () => requested } } }, close() {} };
  internals.netModule = { Time: { Milli: (value: number) => value } };
  internals.delay = { peek: () => requested, set: (value: number) => { requested = value; } };
  internals.paused = { set: (value: boolean) => { paused = value; } };
  internals.reconnect = () => { recoveries++; };
  const status: PlaybackStatus = { instanceId: "one", revision: 1, generation: 1, trackId: null,
    position: 0, duration: 100, state: "playing", params: DEFAULT_DSP_PARAMS, error: null };
  internals.apply(status);
  try {
    backend.setListenerPaused(true); internals.apply({ ...status, revision: 2 });
    expect(paused).toBe(true); expect(resumes).toBe(0);
    internals.background.visibility(true, performance.now());
    internals.heardAudio = true; internals.refillUntil = 0; internals.mediaProgressAt = performance.now() - 30000;
    internals.monitorMedia();
    expect(requested).toBe(1500);
    backend.setListenerPaused(false);
    expect(paused).toBe(false); expect(resumes).toBe(1);
    internals.heardAudio = true; internals.refillUntil = 0; internals.mediaProgressAt = performance.now() - 30000;
    internals.monitorMedia(); await Bun.sleep(550);
    expect(internals.latency.targetMs).toBe(100); expect(internals.latency.underruns).toBe(0); expect(recoveries).toBe(0);
    internals.background.visibility(false, performance.now());
    internals.monitorMedia(); // Stale foreground timestamp is not a 30-second speaker gap.
    expect(recoveries).toBe(0);
  } finally { backend.dispose(); }
});
