// Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { PlaybackMediaSession } from "../audio/media-session";
import { requestPlaybackAudioSession } from "../audio/audio-session";
import { installControllerMediaSession } from "../interactions/playback-media-session";
import { authorizeTestSession } from "./session-fixture";
import { usePlayerStore, installPlayerBackendForTest, installPlaybackWakeLockForTest } from "../stores/player";
import type { PasskeyRole, Track } from "@jmmp/shared";

class FakeMediaSession {
  metadata: MediaMetadata | null = null;
  playbackState: MediaSessionPlaybackState = "none";
  position: MediaPositionState | undefined;
  handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) { this.handlers.set(action, handler); }
  setPositionState(position?: MediaPositionState) { this.position = position; }
}
const song: Track = { id: 1, sourceId: 1, sourceTrackId: "one", title: "One", artist: "Artist", album: "Album", durationMs: 100000, codec: "opus" };
class Backend extends EventTarget {
  pauses = 0;
  async play() {} pause() { this.pauses++; } resume() {} stop() {} async seek() {} setParams() {} setVolume() {}
}

test("V42 playback audio category is requested and unsupported/rejected APIs are harmless", () => {
  const session = { type: "auto" }; requestPlaybackAudioSession({ audioSession: session });
  expect(session.type).toBe("playback");
  expect(() => requestPlaybackAudioSession({})).not.toThrow();
  expect(() => requestPlaybackAudioSession({ audioSession: { get type() { return "ambient"; }, set type(_value) { throw new Error("NotSupportedError"); } } })).not.toThrow();
});

test("V43 stale OS callbacks obey replaced permissions, disposal and route ownership", () => {
  const session = new FakeMediaSession(), bridge = new PlaybackMediaSession(session);
  let sharedWrites = 0;
  bridge.update(null, "playing", { pause: () => { sharedWrites++; } }, { duration: 100, position: 12 });
  const retained = session.handlers.get("pause")!;
  retained({ action: "pause" }); expect(sharedWrites).toBe(1);
  bridge.update(null, "paused", {});
  retained({ action: "pause" }); expect(sharedWrites).toBe(1);
  expect(session.position).toBeUndefined();
  bridge.update(null, "playing", { pause: () => { sharedWrites++; } });
  const replacement = new PlaybackMediaSession(session);
  retained({ action: "pause" }); expect(sharedWrites).toBe(1);
  replacement.update(null, "paused", { play: () => { sharedWrites++; } });
  bridge.dispose(); // Old route cannot clear the new route's controls.
  session.handlers.get("play")!({ action: "play" }); expect(sharedWrites).toBe(2);
  replacement.dispose(); expect(session.playbackState).toBe("none");
  expect([...session.handlers.values()].every(handler => handler === null)).toBe(true);
});

test("V43 controller OS controls follow roles/mode/ownership and recheck before reactive updates", async () => {
  const session = new FakeMediaSession();
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaSession");
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
  try {
    for (const role of ["viewer", "player", "dj", "admin"] satisfies PasskeyRole[]) {
      for (const moqEnabled of [false, true]) {
        setActivePinia(createPinia());
        const auth = authorizeTestSession(role, moqEnabled), player = usePlayerStore();
        player.current = song; player.duration = 100; player.position = 12; player.state = "playing";
        const backend = new Backend(), restoreBackend = installPlayerBackendForTest(backend), restoreWakeLock = installPlaybackWakeLockForTest(null);
        const dispose = installControllerMediaSession();
        try {
          const allowed = role === "admin" || role === "dj" || role === "player" && moqEnabled;
          const handler = session.handlers.get("pause");
          expect(!!handler).toBe(allowed);
          if (!handler) continue;
          handler({ action: "pause" }); expect(backend.pauses).toBe(1);
          auth.me!.role = "viewer";
          handler({ action: "pause" }); expect(backend.pauses).toBe(1);
          await nextTick(); expect(session.handlers.get("pause")).toBeNull();
          auth.me!.role = role; await nextTick();
          auth.me!.isPlayer = false;
          handler({ action: "pause" }); expect(backend.pauses).toBe(1);
          await nextTick(); expect(session.handlers.get("pause")).toBeNull();
          auth.me!.isPlayer = true; await nextTick(); auth.hasFullSession = false;
          handler({ action: "pause" }); expect(backend.pauses).toBe(1);
          await nextTick(); expect(session.handlers.get("pause")).toBeNull();
        } finally { dispose(); restoreBackend(); restoreWakeLock(); }
      }
    }
  } finally {
    if (original) Object.defineProperty(navigator, "mediaSession", original);
    else Reflect.deleteProperty(navigator, "mediaSession");
  }
});

test("V43 partially supported Media Session never blocks playback controls", () => {
  const session = new FakeMediaSession();
  session.setActionHandler = () => { throw new Error("NotSupportedError"); };
  session.setPositionState = () => { throw new Error("NotSupportedError"); };
  const bridge = new PlaybackMediaSession(session);
  expect(() => bridge.update(null, "playing", { pause() {} })).not.toThrow();
  expect(() => bridge.dispose()).not.toThrow();
});
