<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero
      title="Artists"
      :subtitle="`${filteredArtists.length} of ${catalog.artists.length} artists`"
    />
    <ListFilter v-model="filter" placeholder="Filter artists" />
    <div class="artists-list">
      <button
        v-for="a in filteredArtists"
        :key="a.id"
        class="artist-row"
        :class="{ active: selected === a.name }"
        @click="onArtistClick($event, a)"
        @contextmenu.prevent.stop="artistMenuTrigger.onContextMenu($event, a)"
        @pointerdown="artistMenuTrigger.onPointerDown($event, a)"
        @pointermove="artistMenuTrigger.onPointerMove"
        @pointerup="artistMenuTrigger.onPointerEnd"
        @pointercancel="artistMenuTrigger.onPointerEnd"
      >
        <q-icon name="person" size="20px" class="q-mr-sm" />
        <span>{{ a.name }}</span>
        <span class="text-grey-6 q-ml-auto" />
      </button>
    </div>
    <div v-if="selected" class="artist-detail">
      <PageHero :title="selected" eyebrow="Artist" view-toggle />
      <AlbumGrid :albums="albumsForSelected" @select="openAlbum" />
    </div>
    <LibraryObjectMenu ref="artistMenu" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCatalogStore } from "src/stores/catalog";
import { useSourcesStore } from "src/stores/sources";
import type { Album, Artist } from "@jmmp/shared";
import { usePressContextMenu } from "src/interactions/press-context-menu";
import type {
  LibraryInfoRow,
  LibraryMenuContext,
} from "src/library/context-menu";
import PageHero from "src/components/PageHero.vue";
import ListFilter from "src/components/ListFilter.vue";
import AlbumGrid from "src/components/AlbumGrid.vue";
import LibraryObjectMenu from "src/components/LibraryObjectMenu.vue";

const catalog = useCatalogStore();
const sources = useSourcesStore();
const route = useRoute();
const router = useRouter();
const selected = ref<string | null>(null);
const albumsForSelected = ref<Album[]>([]);
const filter = ref("");

const filteredArtists = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return catalog.artists;
  return catalog.artists.filter((a) => a.name.toLowerCase().includes(q));
});
const artistMenu = ref<{
  show: (event: Event, context: LibraryMenuContext) => void;
} | null>(null);
const artistMenuTrigger = usePressContextMenu<Artist>({
  keyFor: (artist) => artist.id,
  open: (event, artist) => {
    artistMenu.value?.show(event, artistContext(artist));
  },
});

onMounted(async () => {
  try {
    await Promise.all([
      catalog.loadArtists(),
      sources.loaded ? Promise.resolve() : sources.load().catch(() => {}),
    ]);
    await selectFromRoute();
  } catch {
    /* ignore */
  }
});

watch(() => [route.query.artist, route.query.source], () => {
  void selectFromRoute();
});

async function select(name: string, sourceId?: number): Promise<void> {
  selected.value = name;
  try {
    albumsForSelected.value = await catalog.loadAlbums(name, sourceId);
  } catch {
    /* ignore */
  }
}

function onArtistClick(event: MouseEvent, artist: Artist): void {
  if (artistMenuTrigger.consumeClick(event, artist)) return;
  void select(artist.name, artist.sourceId);
}

function openAlbum(a: Album): void {
  void router.push({
    name: "album",
    query: { album: a.title, artist: a.artist, source: String(a.sourceId) },
  });
}

async function selectFromRoute(): Promise<void> {
  const artist = typeof route.query.artist === "string" ? route.query.artist : "";
  if (!artist) return;
  const sourceId =
    typeof route.query.source === "string" ? Number(route.query.source) : undefined;
  await select(artist, Number.isFinite(sourceId) ? sourceId : undefined);
}

function artistContext(artist: Artist): LibraryMenuContext {
  return {
    kind: "Artist",
    title: artist.name,
    subtitle: sourceName(artist.sourceId),
    icon: "person",
    playlistLabel: "Add artist to playlist",
    infoRows: artistInfoRows(artist),
    loadTracks: () => catalog.loadTracksByArtist(artist.name, artist.sourceId),
  };
}

function artistInfoRows(artist: Artist): LibraryInfoRow[] {
  return [
    { label: "Type", value: "Artist" },
    { label: "Artist", value: artist.name },
    { label: "Source", value: sourceName(artist.sourceId) },
  ];
}

function sourceName(sourceId: number): string {
  return (
    sources.sources.find((source) => source.id === sourceId)?.name ??
    `Source ${sourceId}`
  );
}
</script>

<style scoped>
.artists-list {
  padding: 16px 32px 24px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px;
}

.artist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--am-text-primary);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.artist-row:hover {
  background: var(--am-row-hover);
}

.artist-row.active {
  background: rgba(255, 45, 85, 0.12);
  color: #ff6b87;
}

.artist-detail {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  margin-top: 12px;
}
</style>
