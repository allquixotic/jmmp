<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero
      title="Browse"
      subtitle="Albums across all your sources."
      view-toggle
    />

    <ListFilter v-model="filter" placeholder="Filter albums" />

    <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
      {{ error }}
    </q-banner>

    <AlbumGrid
      :albums="filteredAlbums"
      empty-label="No albums yet — add a source and scan."
      @select="openAlbum"
    />

    <!-- Desktop only: in-place album detail modal. Mobile uses the AlbumPage route. -->
    <q-dialog v-if="$q.screen.gt.sm" v-model="albumOpen" full-width>
      <q-card v-if="selected" class="album-detail-card">
        <q-card-section class="album-detail-header">
          <AlbumCover :hash="selected.artHash" :alt="selected.title" :size="200" />
          <div class="album-detail-text">
            <div class="album-detail-eyebrow">Album</div>
            <div class="album-detail-title">{{ selected.title }}</div>
            <div class="album-detail-artist">{{ selected.artist }}</div>
            <div class="q-mt-md">
              <q-btn unelevated color="primary" icon="play_arrow" label="Play" @click="playAll" />
              <q-btn flat class="q-ml-sm" icon="shuffle" label="Shuffle" @click="shuffleAll" />
            </div>
          </div>
        </q-card-section>
        <TrackList
          :tracks="tracksForSelected"
          :playing-track-id="player.current?.id ?? null"
          link-metadata
          @play="playOne"
          @view-artist="openTrackArtist"
          @view-album="openTrackAlbum"
        />
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { catalogKey, useCatalogStore } from "src/stores/catalog";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import type { Album, Track } from "@jmmp/shared";
import PageHero from "src/components/PageHero.vue";
import ListFilter from "src/components/ListFilter.vue";
import AlbumGrid from "src/components/AlbumGrid.vue";
import AlbumCover from "src/components/AlbumCover.vue";
import TrackList from "src/components/TrackList.vue";

const catalog = useCatalogStore();
const queue = useQueueStore();
const player = usePlayerStore();
const router = useRouter();
const $q = useQuasar();

const albums = ref<Album[]>([]);
const error = ref<string | null>(null);
const selected = ref<Album | null>(null);
const albumOpen = ref(false);
const filter = ref("");

const filteredAlbums = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return albums.value;
  return albums.value.filter(
    (a) =>
      a.title.toLowerCase().includes(q) ||
      (a.artist ?? "").toLowerCase().includes(q)
  );
});

onMounted(async () => {
  try {
    albums.value = await catalog.loadAlbums();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

async function openAlbum(album: Album): Promise<void> {
  if ($q.screen.lt.md) {
    await router.push({
      name: "album",
      query: {
        album: album.title,
        artist: album.albumArtist || album.artist,
        source: String(album.sourceId),
      },
    });
    return;
  }
  selected.value = album;
  albumOpen.value = true;
  try {
    await catalog.loadTracks(
      album.title,
      album.albumArtist || album.artist,
      album.sourceId
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

const tracksForSelected = computed<Track[]>(() =>
      selected.value
    ? (catalog.tracks[
        catalogKey(
          selected.value.title,
          selected.value.sourceId,
          selected.value.albumArtist || selected.value.artist
        )
      ] ?? [])
    : []
);

async function playAll(): Promise<void> {
  if (tracksForSelected.value.length === 0) return;
  const first = await queue.playFromTracks(tracksForSelected.value, 0);
  if (first) await player.play(first);
}

async function shuffleAll(): Promise<void> {
  const ts = [...tracksForSelected.value];
  for (let i = ts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ts[i]!;
    ts[i] = ts[j]!;
    ts[j] = tmp;
  }
  const first = await queue.playFromTracks(ts, 0);
  if (first) await player.play(first);
}

async function playOne(_t: Track, i: number): Promise<void> {
  const first = await queue.playFromTracks(tracksForSelected.value, i);
  if (first) await player.play(first);
}

function openTrackArtist(artist: string): void {
  albumOpen.value = false;
  if (!artist) return;
  void router.push({ name: "library-artists", query: { artist } });
}

function openTrackAlbum(track: Track): void {
  albumOpen.value = false;
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
</script>

<style scoped>
.album-detail-card {
  background: rgba(20, 22, 28, 0.95);
  color: var(--am-text-primary);
  max-width: 1100px;
  width: 92vw;
}

.album-detail-header {
  display: flex;
  gap: 28px;
  align-items: flex-end;
  padding: 32px;
}

.album-detail-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.album-detail-eyebrow {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #ff6b87;
}

.album-detail-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.album-detail-artist {
  font-size: 16px;
  color: var(--am-text-secondary);
}
</style>
