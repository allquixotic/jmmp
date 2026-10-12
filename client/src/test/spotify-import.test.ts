// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import type { Playlist } from "@jmmp/shared";
import { api } from "../api";
import { authorizeTestSession } from "./session-fixture";
import { usePlaylistsStore } from "../stores/playlists";

const playlist: Playlist = { id: 1, name: "Imported", createdAt: 1, updatedAt: 1, pinnedAt: null, trackCount: 3, storage: { kind: "local", label: "jmmp server" } };

test("V19/V20 Spotify import reports progress and preserves the skipped-item result", async () => {
  setActivePinia(createPinia()); authorizeTestSession("dj");
  const store = usePlaylistsStore(), progress: number[] = [];
  const start = spyOn(api, "post").mockResolvedValue({ jobId: "saved-account-import" });
  const status = spyOn(api, "get").mockResolvedValueOnce({ status: "pending", tracks: 14 })
    .mockResolvedValueOnce({ status: "complete", playlist, skippedTracks: 2 });
  try {
    expect(await store.importSpotify(2, "https://open.spotify.com/playlist/44rdeZbcbwTILcMXDMoHTk", n => progress.push(n)))
      .toEqual({ playlist, skippedTracks: 2 });
    expect(progress).toEqual([14]); expect(store.playlists).toEqual([playlist]);
    expect(start.mock.calls[0]![1]).toEqual({ sourceId: 2, url: "https://open.spotify.com/playlist/44rdeZbcbwTILcMXDMoHTk" });
    expect(status.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  } finally { start.mockRestore(); status.mockRestore(); }
});

test("V19 stalled import polling shares a finite deadline with the start request", async () => {
  setActivePinia(createPinia()); authorizeTestSession("dj");
  const controller = new AbortController();
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    expect(ms).toBe(6 * 60 * 1000); return controller.signal;
  });
  const start = spyOn(api, "post").mockResolvedValue({ jobId: "stalled" });
  const status = spyOn(api, "get").mockImplementation(async (_path, options) => {
    expect(options?.signal).toBe(controller.signal);
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    throw controller.signal.reason;
  });
  try {
    await expect(usePlaylistsStore().importSpotify(2, "spotify:playlist:44rdeZbcbwTILcMXDMoHTk")).rejects.toThrow("Timed out");
    expect(start.mock.calls[0]![2]?.signal).toBe(controller.signal);
    expect(timeout).toHaveBeenCalledTimes(1);
  } finally { timeout.mockRestore(); start.mockRestore(); status.mockRestore(); }
});
