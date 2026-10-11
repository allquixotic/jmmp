<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero title="Search">
      <template v-slot:actions>
        <q-input
          v-if="$q.screen.lt.md"
          v-model="mobileSearchValue"
          dense
          borderless
          autofocus
          clearable
          placeholder="Title, artist, or album"
          :debounce="250"
          class="search-input"
          @update:model-value="updateSearchRoute"
        >
          <template v-slot:prepend><q-icon name="search" size="18px" /></template>
        </q-input>
      </template>
    </PageHero>

    <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
      {{ error }}
    </q-banner>

    <q-banner v-for="failure in result?.sourceErrors ?? []" :key="failure.sourceId" role="alert" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
      {{ sources.sources.find(source => source.id === failure.sourceId)?.name ?? 'Source' }}: {{ failure.error }}
    </q-banner>
    <div class="search-tools">
      <q-select
        v-model="sourceFilter"
        :options="sourceOptions"
        label="Source"
        dense
        outlined
        emit-value
        map-options
        class="search-tool"
      />
      <q-select
        v-model="fieldFilter"
        :options="fieldOptions"
        label="Field"
        dense
        outlined
        emit-value
        map-options
        class="search-tool"
      />
      <q-select
        v-model="sortMode"
        :options="sortOptions"
        label="Sort"
        dense
        outlined
        emit-value
        map-options
        class="search-tool"
      />
      <q-select
        v-model="groupMode"
        :options="groupOptions"
        label="Group"
        dense
        outlined
        emit-value
        map-options
        class="search-tool"
      />
      <q-btn flat icon="view_column" label="Columns">
        <q-menu>
          <q-list dense style="min-width: 180px">
            <q-item-label header>Displayed columns</q-item-label>
            <q-option-group
              v-model="visibleColumns"
              :options="columnOptions"
              type="checkbox"
              dense
            />
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <div v-if="result && visibleTracks.length > 0" class="search-section">
      <h2 class="search-section-title">Tracks</h2>
      <template v-if="groupMode === 'none'">
        <TrackList
          :tracks="visibleTracks"
          :playing-track-id="player.current?.id ?? null"
          selectable
          sortable
          :columns="visibleColumns"
          :sort-key="sortMode === 'relevance' ? null : sortMode"
          :sort-direction="sortDirection"
          :selected-track-ids="selectedTrackIds"
          link-metadata
          @select="selectTrack"
          @play="play"
          @sort="cycleSort"
          @view-artist="openTrackArtist"
          @view-album="openTrackAlbum"
        />
      </template>
      <template v-else>
        <section v-for="group in groupedTracks" :key="group.key" class="search-group">
          <h3 class="search-group-title">{{ group.label }}</h3>
          <TrackList
            :tracks="group.tracks"
            :playing-track-id="player.current?.id ?? null"
            selectable
            sortable
            :columns="visibleColumns"
            :sort-key="sortMode === 'relevance' ? null : sortMode"
            :sort-direction="sortDirection"
            :selected-track-ids="selectedTrackIds"
            :selection-scope-tracks="visibleTracks"
            link-metadata
            @select="selectTrack"
            @play="(track, index) => playGrouped(group.tracks, track, index)"
            @sort="cycleSort"
            @view-artist="openTrackArtist"
            @view-album="openTrackAlbum"
          />
        </section>
      </template>
    </div>

    <div v-if="result && visibleAlbums.length > 0" class="search-section">
      <h2 class="search-section-title">Albums</h2>
      <AlbumGrid :albums="visibleAlbums" @select="openAlbum" />
    </div>

    <div v-if="result && visibleArtists.length > 0" class="search-section">
      <h2 class="search-section-title">Artists</h2>
      <div class="artist-results">
        <button
          v-for="artist in visibleArtists"
          :key="artist.id"
          class="artist-result"
          @click="onArtistClick($event, artist)"
          @contextmenu.prevent.stop="artistMenuTrigger.onContextMenu($event, artist)"
          @pointerdown="artistMenuTrigger.onPointerDown($event, artist)"
          @pointermove="artistMenuTrigger.onPointerMove"
          @pointerup="artistMenuTrigger.onPointerEnd"
          @pointercancel="artistMenuTrigger.onPointerEnd"
          @keydown="artistMenuTrigger.onKeyDown($event, artist)"
        >
          <q-icon name="person" size="20px" />
          <span>{{ artist.name }}</span>
        </button>
      </div>
    </div>

    <div v-else-if="q && result && visibleTracks.length === 0 && visibleAlbums.length === 0 && visibleArtists.length === 0" class="search-empty">No results.</div>
    <LibraryObjectMenu ref="artistMenu" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCatalogStore } from "src/stores/catalog";
import { usePlayerStore } from "src/stores/player";
import { useQueueStore } from "src/stores/queue";
import { useSourcesStore } from "src/stores/sources";
import type { Album, Artist, SearchResponse, Track } from "@jmmp/shared";
import PageHero from "src/components/PageHero.vue";
import TrackList from "src/components/TrackList.vue";
import AlbumGrid from "src/components/AlbumGrid.vue";
import LibraryObjectMenu from "src/components/LibraryObjectMenu.vue";
import { usePressContextMenu } from "src/interactions/press-context-menu";
import type {
  LibraryInfoRow,
  LibraryMenuContext,
} from "src/library/context-menu";
import {
  updateTrackSelection,
  type SelectionModifiers,
} from "src/tracks/selection";
import {
  DEFAULT_SEARCH_COLUMNS,
  sortTracksByColumn,
  type SortDirection,
  type TrackColumnKey,
  type TrackSortKey,
} from "src/tracks/sort";

const catalog = useCatalogStore();
const player = usePlayerStore();
const queue = useQueueStore();
const sources = useSourcesStore();
const route = useRoute();
const router = useRouter();

const q = computed(() => routeSearchValue(route.query.q));
const mobileSearchValue = ref(q.value);
const result = ref<SearchResponse | null>(null);
const error = ref<string | null>(null);
const sourceFilter = ref<number | "all">("all");
const fieldFilter = ref<"any" | "title" | "artist" | "album">("any");
const sortMode = ref<"relevance" | TrackSortKey>("relevance");
const sortDirection = ref<SortDirection>("asc");
const groupMode = ref<"none" | "source" | "artist" | "album">("none");
const selectedTrackIds = ref<number[]>([]);
const selectionAnchorId = ref<number | null>(null);
const visibleColumns = ref<TrackColumnKey[]>([...DEFAULT_SEARCH_COLUMNS]);
let searchRunId = 0;
const artistMenu = ref<{
  show: (event: Event, context: LibraryMenuContext) => void;
} | null>(null);
const artistMenuTrigger = usePressContextMenu<Artist>({
  keyFor: (artist) => artist.id,
  open: (event, artist) => artistMenu.value?.show(event, artistContext(artist)),
});

const sourceOptions = computed(() => [
  { label: "All", value: "all" },
  ...sources.sources.map((source) => ({ label: source.name, value: source.id })),
]);
const fieldOptions = [
  { label: "Any", value: "any" },
  { label: "Song", value: "title" },
  { label: "Artist", value: "artist" },
  { label: "Album", value: "album" },
];
const sortOptions = [
  { label: "Relevance", value: "relevance" },
  { label: "Song A-Z", value: "title" },
  { label: "Artist A-Z", value: "artist" },
  { label: "Album A-Z", value: "album" },
  { label: "Source A-Z", value: "source" },
  { label: "Duration", value: "duration" },
  { label: "Codec A-Z", value: "codec" },
  { label: "Quality", value: "quality" },
];
const groupOptions = [
  { label: "None", value: "none" },
  { label: "Source", value: "source" },
  { label: "Artist", value: "artist" },
  { label: "Album", value: "album" },
];
const columnOptions = [
  { label: "Artist", value: "artist" },
  { label: "Album", value: "album" },
  { label: "Source", value: "source" },
  { label: "Time", value: "duration" },
  { label: "Codec", value: "codec" },
  { label: "Quality", value: "quality" },
];

const visibleTracks = computed(() => {
  const tracks = result.value?.tracks ?? [];
  return sortTracks(filterTracks(tracks));
});

const visibleAlbums = computed(() => {
  const albums = filterBySource(result.value?.albums ?? []);
  return [...albums].sort((a, b) => a.title.localeCompare(b.title));
});

const visibleArtists = computed(() => {
  const artists = filterBySource(result.value?.artists ?? []);
  return [...artists].sort((a, b) => a.name.localeCompare(b.name));
});

const groupedTracks = computed(() => {
  const groups = new Map<string, { key: string; label: string; tracks: Track[] }>();
  for (const track of visibleTracks.value) {
    const label = groupLabel(track);
    const key = `${groupMode.value}:${label}`;
    const group = groups.get(key) ?? { key, label, tracks: [] };
    group.tracks.push(track);
    groups.set(key, group);
  }
  return [...groups.values()];
});

onMounted(async () => {
  if (!sources.loaded) await sources.load().catch(() => {});
});

watch(q, (value) => {
  mobileSearchValue.value = value;
});

watch(
  [q, sourceFilter, fieldFilter],
  ([search, sourceId, field]) => {
    void runSearch(search, sourceId, field);
  },
  { immediate: true }
);

watch(
  () => visibleTracks.value.map((track) => track.id),
  (ids) => {
    selectedTrackIds.value = selectedTrackIds.value.filter((id) => ids.includes(id));
    if (
      selectionAnchorId.value !== null &&
      !ids.includes(selectionAnchorId.value)
    ) {
      selectionAnchorId.value = selectedTrackIds.value[0] ?? null;
    }
  }
);

async function runSearch(
  search: string,
  sourceId: number | "all",
  field: "any" | "title" | "artist" | "album"
): Promise<void> {
  const runId = ++searchRunId;
  const s = search.trim();
  result.value = null;
  error.value = null;
  if (s.length < 2) {
    return;
  }

  try {
    const response = await catalog.runSearch(s, {
      sourceId,
      field,
    });
    if (runId !== searchRunId) return;
    result.value = response;
  } catch (err) {
    if (runId !== searchRunId) return;
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function updateSearchRoute(value: string | number | null): void {
  const next = String(value ?? "").trim();
  if (next === q.value) {
    mobileSearchValue.value = q.value;
    return;
  }

  const query = { ...route.query };
  if (next) query.q = next;
  else delete query.q;
  void router.replace({ name: "search", query });
}

function routeSearchValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

async function play(_t: Track, i: number): Promise<void> {
  const first = await queue.playFromTracks(visibleTracks.value, i);
  if (first) await player.play(first);
}

async function playGrouped(tracks: Track[], _t: Track, i: number): Promise<void> {
  const first = await queue.playFromTracks(tracks, i);
  if (first) await player.play(first);
}

function openAlbum(a: Album): void {
  void router.push({
    name: "album",
    query: {
      album: a.title,
      artist: a.albumArtist || a.artist,
      source: String(a.sourceId),
    },
  });
}

function openArtist(artist: Artist): void {
  void router.push({
    name: "library-artists",
    query: { artist: artist.name },
  });
}

function onArtistClick(event: MouseEvent, artist: Artist): void {
  if (artistMenuTrigger.consumeClick(event, artist)) return;
  openArtist(artist);
}

function artistContext(artist: Artist): LibraryMenuContext {
  const filteredSourceId =
    sourceFilter.value === "all" ? undefined : sourceFilter.value;
  return {
    kind: "Artist",
    title: artist.name,
    subtitle: sourceLabel(artist.sourceIds),
    icon: "person",
    playlistLabel: "Add artist to playlist",
    infoRows: artistInfoRows(artist),
    open: () => openArtist(artist),
    loadTracks: () => catalog.loadTracksByArtist(artist.name, filteredSourceId),
  };
}

function artistInfoRows(artist: Artist): LibraryInfoRow[] {
  return [
    { label: "Type", value: "Artist" },
    { label: "Artist", value: artist.name },
    { label: "Sources", value: sourceLabel(artist.sourceIds) },
  ];
}

function openTrackArtist(artist: string): void {
  void router.push({
    name: "library-artists",
    query: { artist },
  });
}

function openTrackAlbum(track: Track): void {
  if (!track.album) return;
  void router.push({
    name: "album",
    query: {
      album: track.album,
      artist: track.albumArtist || track.artist,
      source: String(track.sourceId),
    },
  });
}

function filterTracks(tracks: Track[]): Track[] {
  return filterBySource(tracks).filter((track) => {
    const tokens = searchTokens(q.value);
    if (tokens.length === 0 || fieldFilter.value === "any") return true;
    if (fieldFilter.value === "title") return tokensCoveredByTexts(tokens, [track.title]);
    if (fieldFilter.value === "artist") {
      return tokensCoveredByTexts(tokens, [track.artist, track.albumArtist ?? ""]);
    }
    return tokensCoveredByTexts(tokens, [track.album]);
  });
}

function filterBySource<T extends { sourceId?: number; sourceIds?: number[] }>(items: T[]): T[] {
  if (sourceFilter.value === "all") return items;
  return items.filter((item) =>
    item.sourceIds
      ? item.sourceIds.includes(sourceFilter.value as number)
      : item.sourceId === sourceFilter.value
  );
}

function searchTokens(value: string): string[] {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) =>
    match[0].toLocaleLowerCase()
  );
}

function tokensCoveredByTexts(tokens: string[], texts: string[]): boolean {
  const haystack = searchTokens(texts.join(" "));
  return tokens.every((token) => haystack.some((word) => word.startsWith(token)));
}

function sortTracks(tracks: Track[]): Track[] {
  if (sortMode.value === "relevance") return [...tracks];
  return sortTracksByColumn(
    tracks,
    sortMode.value,
    sortDirection.value,
    sourceName
  );
}

function groupLabel(track: Track): string {
  if (groupMode.value === "source") return sourceName(track.sourceId);
  if (groupMode.value === "artist") return track.artist || "Unknown artist";
  if (groupMode.value === "album") return track.album || "Unknown album";
  return "";
}

function sourceName(sourceId: number): string {
  return sources.sources.find((source) => source.id === sourceId)?.name ?? `Source ${sourceId}`;
}

function sourceLabel(sourceIds: number[]): string {
  return sourceIds.map(sourceName).join(", ");
}

function selectTrack(
  track: Track,
  _index: number,
  modifiers: SelectionModifiers
): void {
  const next = updateTrackSelection(
    visibleTracks.value.map((t) => t.id),
    selectedTrackIds.value,
    selectionAnchorId.value,
    track.id,
    modifiers
  );
  selectedTrackIds.value = next.selectedIds;
  selectionAnchorId.value = next.anchorId;
}

function cycleSort(key: TrackSortKey): void {
  if (sortMode.value !== key) {
    sortMode.value = key;
    sortDirection.value = "asc";
  } else if (sortDirection.value === "asc") {
    sortDirection.value = "desc";
  } else {
    sortMode.value = "relevance";
    sortDirection.value = "asc";
  }
}
</script>

<style scoped>
.search-input {
  background: rgba(255, 255, 255, 0.06);
  padding: 4px 10px;
  border-radius: 8px;
  width: 100%;
  max-width: 360px;
  min-width: 200px;
}

.search-section {
  margin-top: 16px;
}

.search-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 32px 0;
}

.search-tool {
  width: 160px;
}

.search-section-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  padding: 0 32px;
}

.search-group {
  margin-top: 10px;
}

.search-group-title {
  color: var(--am-text-secondary);
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  padding: 6px 32px 4px;
}

.artist-results {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 32px 28px;
}

.artist-result {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--am-text-primary);
  padding: 0 12px;
  cursor: pointer;
}

.artist-result:hover {
  background: var(--am-row-hover);
}

.search-empty {
  padding: 48px;
  text-align: center;
  color: var(--am-text-muted);
}
</style>
