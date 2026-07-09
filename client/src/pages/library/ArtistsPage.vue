<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <template v-if="selected">
      <PageHero
        :title="selected"
        :subtitle="artistSubtitle"
        eyebrow="Artist"
        view-toggle
      >
        <template #actions>
          <q-btn flat dense icon="arrow_back" label="Artists" @click="clearArtist" />
          <q-btn
            unelevated
            color="primary"
            icon="play_arrow"
            label="Play"
            :disable="tracksForSelected.length === 0"
            @click="playAll"
          />
          <q-btn
            flat
            icon="shuffle"
            label="Shuffle"
            :disable="tracksForSelected.length === 0"
            @click="shuffleAll"
          />
        </template>
      </PageHero>

      <section class="artist-section">
        <h2 class="artist-section-title">Albums</h2>
        <AlbumGrid
          :albums="albumsForSelected"
          empty-label="No albums found for this artist."
          @select="openAlbum"
        />
      </section>

      <section class="artist-section">
        <h2 class="artist-section-title">Songs</h2>
        <TrackList
          :tracks="tracksForSelected"
          :playing-track-id="player.current?.id ?? null"
          empty-label="No songs found for this artist."
          link-metadata
          @play="playOne"
          @view-artist="openTrackArtist"
          @view-album="openTrackAlbum"
        />
      </section>
    </template>

    <template v-else>
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
          @click="onArtistClick($event, a)"
          @dblclick="openArtist(a)"
          @contextmenu.prevent.stop="artistMenuTrigger.onContextMenu($event, a)"
          @pointerdown="artistMenuTrigger.onPointerDown($event, a)"
          @pointermove="artistMenuTrigger.onPointerMove"
          @pointerup="artistMenuTrigger.onPointerEnd"
          @pointercancel="artistMenuTrigger.onPointerEnd"
          @keydown="artistMenuTrigger.onKeyDown($event, a)"
        >
          <q-icon name="person" size="20px" class="q-mr-sm" />
          <span>{{ a.name }}</span>
          <span class="text-grey-6 q-ml-auto" />
        </button>
      </div>
    </template>
    <LibraryObjectMenu ref="artistMenu" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCatalogStore } from "src/stores/catalog";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import { useSourcesStore } from "src/stores/sources";
import type { Album, Artist, Track } from "@jmmp/shared";
import { usePressContextMenu } from "src/interactions/press-context-menu";
import type {
  LibraryInfoRow,
  LibraryMenuContext,
} from "src/library/context-menu";
import PageHero from "src/components/PageHero.vue";
import ListFilter from "src/components/ListFilter.vue";
import AlbumGrid from "src/components/AlbumGrid.vue";
import TrackList from "src/components/TrackList.vue";
import LibraryObjectMenu from "src/components/LibraryObjectMenu.vue";

const catalog = useCatalogStore();
const queue = useQueueStore();
const player = usePlayerStore();
const sources = useSourcesStore();
const route = useRoute();
const router = useRouter();
const selected = ref<string | null>(null);
const albumsForSelected = ref<Album[]>([]);
const tracksForSelected = ref<Track[]>([]);
const filter = ref("");
let artistLoadId = 0;

const filteredArtists = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return catalog.artists;
  return catalog.artists.filter((a) => a.name.toLowerCase().includes(q));
});
const selectedArtist = computed(() =>
  selected.value
    ? (catalog.artists.find((artist) => artist.name === selected.value) ?? null)
    : null
);
const artistSubtitle = computed(() => {
  const counts = `${albumsForSelected.value.length} albums - ${tracksForSelected.value.length} songs`;
  const artist = selectedArtist.value;
  return artist ? `${counts} - ${sourceLabel(artist.sourceIds)}` : counts;
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

watch(() => route.query.artist, () => {
  void selectFromRoute();
});

async function select(name: string): Promise<void> {
  const loadId = ++artistLoadId;
  selected.value = name;
  albumsForSelected.value = [];
  tracksForSelected.value = [];
  try {
    const [albums, tracks] = await Promise.all([
      catalog.loadAlbums(name),
      catalog.loadTracksByArtist(name),
    ]);
    if (loadId !== artistLoadId || selected.value !== name) return;
    albumsForSelected.value = albums;
    tracksForSelected.value = tracks;
  } catch {
    /* ignore */
  }
}

function onArtistClick(event: MouseEvent, artist: Artist): void {
  if (artistMenuTrigger.consumeClick(event, artist)) return;
  openArtist(artist);
}

function openArtist(artist: Artist): void {
  void router.push({ name: "library-artists", query: { artist: artist.name } });
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

async function selectFromRoute(): Promise<void> {
  const artist = typeof route.query.artist === "string" ? route.query.artist : "";
  if (!artist) {
    clearSelectedArtist();
    return;
  }
  await select(artist);
}

function clearArtist(): void {
  void router.push({ name: "library-artists" });
}

function clearSelectedArtist(): void {
  artistLoadId++;
  selected.value = null;
  albumsForSelected.value = [];
  tracksForSelected.value = [];
}

function openTrackArtist(artist: string): void {
  if (!artist) return;
  void router.push({ name: "library-artists", query: { artist } });
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

async function playAll(): Promise<void> {
  if (tracksForSelected.value.length === 0) return;
  const first = await queue.playFromTracks(tracksForSelected.value, 0);
  if (first) await player.play(first);
}

async function shuffleAll(): Promise<void> {
  const tracks = [...tracksForSelected.value];
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = tracks[i]!;
    tracks[i] = tracks[j]!;
    tracks[j] = tmp;
  }
  const first = await queue.playFromTracks(tracks, 0);
  if (first) await player.play(first);
}

async function playOne(_track: Track, index: number): Promise<void> {
  const first = await queue.playFromTracks(tracksForSelected.value, index);
  if (first) await player.play(first);
}

function artistContext(artist: Artist): LibraryMenuContext {
  return {
    kind: "Artist",
    title: artist.name,
    subtitle: sourceLabel(artist.sourceIds),
    icon: "person",
    playlistLabel: "Add artist to playlist",
    infoRows: artistInfoRows(artist),
    open: () => openArtist(artist),
    loadTracks: () => catalog.loadTracksByArtist(artist.name),
  };
}

function artistInfoRows(artist: Artist): LibraryInfoRow[] {
  return [
    { label: "Type", value: "Artist" },
    { label: "Artist", value: artist.name },
    { label: "Sources", value: sourceLabel(artist.sourceIds) },
  ];
}

function sourceLabel(sourceIds: number[]): string {
  return sourceIds.map(sourceName).join(", ");
}

function sourceName(sourceId: number): string {
  return sources.sources.find((source) => source.id === sourceId)?.name ?? `Source ${sourceId}`;
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

.artist-section {
  margin-top: 22px;
}

.artist-section-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
  padding: 0 32px;
  color: var(--am-text-primary);
}
</style>
