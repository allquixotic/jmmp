// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../api";
import { useQueueStore } from "../stores/queue";
import { usePlayerStore, installPlayerBackendForTest } from "../stores/player";
import { useSettingsStore } from "../stores/settings";
import { usePlaylistsStore } from "../stores/playlists";
import { tabLock } from "../tabs/tab-lock";
import { authorizeTestSession } from "./session-fixture";
import { RoutingPlayer } from "../audio/routing-player";
import { DEFAULT_DSP_PARAMS } from "@jmmp/shared";

test("V38 a new controller can pause, seek and adjust an existing MoQ stream without selecting a track", async () => {
  setActivePinia(createPinia()); authorizeTestSession("player", true);
  const status = { instanceId: "test", generation: 1, revision: 1, state: "playing", trackId: 1, position: 0, duration: 100, params: DEFAULT_DSP_PARAMS, error: null };
  const commands: unknown[] = [];
  const get = spyOn(api, "get").mockResolvedValue(status);
  const post = spyOn(api, "post").mockImplementation(async (_path, body) => { commands.push((body as { command: unknown }).command); return status as never; });
  try {
    const routing = new RoutingPlayer();
    routing.pause(); await routing.seek(3);
    routing.setVolume(.4); await routing.seek(4);
    expect(commands).toEqual([{ type: "pause" }, { type: "seek", position: 3 }, { type: "params", params: { volume: .4 } }, { type: "seek", position: 4 }]);
    expect(get.mock.calls.every(([path]) => path === "/api/playback")).toBe(true);
  } finally { get.mockRestore(); post.mockRestore(); }
});

test("V38 viewer actions never call write APIs or claim a tab lock; local layout changes still work", async () => {
  setActivePinia(createPinia()); const session = authorizeTestSession("viewer", true);
  const post = spyOn(api, "post"), put = spyOn(api, "put"), claim = spyOn(tabLock, "takeControl"), start = spyOn(tabLock, "start");
  const backend = new EventTarget() as EventTarget & { play: () => Promise<void>; pause: () => void; resume: () => void; stop: () => void; seek: () => Promise<void>; setVolume: () => void; setParams: () => void };
  let commands = 0;
  Object.assign(backend, { play: async () => { commands++; }, pause: () => { commands++; }, resume: () => { commands++; }, stop: () => { commands++; }, seek: async () => { commands++; }, setVolume: () => { commands++; }, setParams: () => { commands++; } });
  const restore = installPlayerBackendForTest(backend);
  try {
    session.startPlayerLock();
    const track = { id: 1, sourceId: 1, sourceTrackId: "a.mp3", title: "A", artist: "B", album: "C", codec: "mp3" as const, durationMs: 1000 };
    const player = usePlayerStore(); player.current = track;
    await player.play(track); player.pause(); player.resume(); player.stop(); await player.seek(10); player.setVolume(0); player.setParams({ pitchSemi: 4 });
    await useQueueStore().replace([1]); await useQueueStore().append([1]);
    expect(await useQueueStore().playFromTracks([track])).toBeNull();
    await expect(usePlaylistsStore().create("Denied")).rejects.toThrow("DJ or admin");
    const settings = useSettingsStore(); settings.patch({ libraryView: "grid" }); await settings.flush();
    expect(settings.settings.libraryView).toBe("grid");
    expect(commands).toBe(0); expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  } finally { post.mockRestore(); put.mockRestore(); claim.mockRestore(); start.mockRestore(); restore(); }
});

test("V38 player controls require MoQ; DJs/admins retain local playback", () => {
  setActivePinia(createPinia());
  const session = authorizeTestSession("player", false);
  expect(session.canControl).toBe(false); expect(session.canAddSources).toBe(false); expect(session.canEditPlaylists).toBe(false);
  session.me!.moqEnabled = true; expect(session.canControl).toBe(true);
  session.me!.role = "dj"; session.me!.moqEnabled = false;
  expect(session.canControl).toBe(true); expect(session.canAddSources).toBe(true); expect(session.canEditPlaylists).toBe(true); expect(session.isAdmin).toBe(false);
});
