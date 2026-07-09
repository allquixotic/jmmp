// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

async function sourceText(path: string): Promise<string> {
  return await Bun.file(new URL(path, import.meta.url)).text();
}

describe("search navigation wiring", () => {
  test("uses the route query as the single search source across desktop and mobile", async () => {
    const sideNav = await sourceText("../components/SideNav.vue");
    const searchPage = await sourceText("../pages/SearchPage.vue");

    expect(sideNav).toContain("() => route.query.q");
    expect(sideNav).toContain("{ immediate: true }");
    expect(sideNav).toContain('@click="clearSearch"');
    expect(sideNav).toContain("delete query.q");
    expect(searchPage).toContain('v-if="$q.screen.lt.md"');
    expect(searchPage).toContain('v-model="mobileSearchValue"');
    expect(searchPage).toContain(':debounce="250"');
    expect(searchPage).toContain('@update:model-value="updateSearchRoute"');
    expect(searchPage).toContain("computed(() => routeSearchValue(route.query.q))");
    expect(searchPage).toContain('router.replace({ name: "search", query })');
  });

  test("runs one immediate route-backed search and ignores stale responses", async () => {
    const source = await sourceText("../pages/SearchPage.vue");

    expect(source).toContain("[q, sourceFilter, fieldFilter]");
    expect(source).toContain("{ immediate: true }");
    expect(source).toContain("const runId = ++searchRunId");
    expect(source).toContain("if (runId !== searchRunId) return");
    expect(source).not.toContain("if (q.value) await onSearch(q.value)");
    expect(source).not.toContain('@update:model-value="onSearch"');
    expect(source).not.toContain('@update:model-value="rerunSearch"');
  });

  test("search track rows opt into metadata links and navigation events", async () => {
    const source = await sourceText("../pages/SearchPage.vue");

    expect(source).toContain("link-metadata");
    expect(source).toContain('@view-artist="openTrackArtist"');
    expect(source).toContain('@view-album="openTrackAlbum"');
    expect(source).toContain('name: "library-artists"');
    expect(source).toContain('query: { artist }');
    expect(source).toContain('name: "album"');
    expect(source).toContain('source: String(track.sourceId)');
  });

  test("track row menus expose artist and album navigation actions", async () => {
    const source = await sourceText("../components/TrackList.vue");

    expect(source).toContain("View Artist");
    expect(source).toContain("View Album");
    expect(source).toContain("emit(\"viewArtist\"");
    expect(source).toContain("emit(\"viewAlbum\"");
  });

  test("artist page routes selections through merged artist names", async () => {
    const source = await sourceText("../pages/library/ArtistsPage.vue");

    expect(source).toContain('query: { artist: artist.name }');
    expect(source).toContain("catalog.loadAlbums(name)");
    expect(source).toContain("catalog.loadTracksByArtist(name)");
    expect(source).toContain("catalog.loadTracksByArtist(artist.name)");
    expect(source).toContain("sourceLabel(artist.sourceIds)");
    expect(source).not.toContain("route.query.source");
    expect(source).not.toMatch(/artist\.sourceId(?!s)/);
  });

  test("artist route query opens a detail page instead of leaving detail below the full index", async () => {
    const source = await sourceText("../pages/library/ArtistsPage.vue");
    const detailIndex = source.indexOf('<template v-if="selected">');
    const listIndex = source.indexOf('<template v-else>');

    expect(detailIndex).toBeGreaterThan(-1);
    expect(listIndex).toBeGreaterThan(detailIndex);
    expect(source).toContain("tracksForSelected");
    expect(source).toContain("clearArtist");
  });
});
