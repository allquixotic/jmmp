// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

describe("PlaylistList component", () => {
  test("renders the playlist prop instead of enumerating the Pinia store", async () => {
    const source = await Bun.file(
      new URL("../components/PlaylistList.vue", import.meta.url)
    ).text();

    expect(source).toContain('v-for="p in props.playlists"');
    expect(source).not.toContain("const playlists = usePlaylistsStore()");
  });
});
