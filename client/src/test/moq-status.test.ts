// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { DEFAULT_DSP_PARAMS, type PlaybackStatus } from "@jmmp/shared";
import { MoqPlayer } from "../audio/moq";

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
