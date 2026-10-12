<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <header class="album-header">
      <AlbumCover :hash="firstTrack?.artHash" :alt="albumTitle" :size="$q.screen.lt.md ? 160 : 220" />
      <div class="album-header-text">
        <div class="album-header-eyebrow">Album</div>
        <div class="album-header-title">{{ albumTitle }}</div>
        <div class="album-header-artist">{{ artistName }}</div>
        <div class="album-actions">
          <q-btn unelevated color="primary" v-if="session.canControl" icon="play_arrow" label="Play" :disable="tracks.length === 0" @click="playAll" />
          <q-btn flat v-if="session.canControl" icon="shuffle" label="Shuffle" @click="shuffleAll" />
        </div>
      </div>
    </header>
    <TrackList
      :tracks="tracks"
      :playing-track-id="player.current?.id ?? null"
      empty-label="No tracks in this album yet."
      link-metadata
      @play="playAt"
      @view-artist="openTrackArtist"
      @view-album="openTrackAlbum"
    />
  </q-page>
</template>

<script setup lang="ts">
import { useSessionStore } from "src/stores/session";
const session = useSessionStore();
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "src/api";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import type { Track, TrackListResponse } from "@jmmp/shared";
import AlbumCover from "src/components/AlbumCover.vue";
import TrackList from "src/components/TrackList.vue";

const route = useRoute();
const router = useRouter();
const queue = useQueueStore();
const player = usePlayerStore();

const tracks = ref<Track[]>([]);

const albumTitle = computed(() => String(route.query.album ?? "Album"));
const artistName = computed(() => String(route.query.artist ?? ""));
const sourceId = computed(() => {
  const n = Number(route.query.source);
  return Number.isFinite(n) && n > 0 ? n : null;
});
const firstTrack = computed(() => tracks.value[0] ?? null);

async function load(): Promise<void> {
  const params = new URLSearchParams();
  params.set("album", albumTitle.value);
  if (artistName.value) params.set("artist", artistName.value);
  if (sourceId.value) params.set("source", String(sourceId.value));
  const resp = await api.get<TrackListResponse>(
    `/api/catalog/tracks?${params.toString()}`
  );
  tracks.value = resp.tracks;
}

onMounted(load);
watch(() => [route.query.album, route.query.artist, route.query.source], load);

async function playAll(): Promise<void> {
  if (tracks.value.length === 0) return;
  const first = await queue.playFromTracks(tracks.value, 0);
  if (first) await player.play(first);
}

async function shuffleAll(): Promise<void> {
  const ts = [...tracks.value];
  for (let i = ts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ts[i]!;
    ts[i] = ts[j]!;
    ts[j] = tmp;
  }
  const first = await queue.playFromTracks(ts, 0);
  if (first) await player.play(first);
}

async function playAt(_t: Track, i: number): Promise<void> {
  const first = await queue.playFromTracks(tracks.value, i);
  if (first) await player.play(first);
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
</script>

<style scoped>
.album-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

@media (min-width: 600px) {
  .album-header {
    flex-direction: row;
    align-items: flex-end;
    gap: 28px;
    padding: 32px;
  }
}

.album-header-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.album-header-eyebrow {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #ff6b87;
}

.album-header-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.album-header-artist {
  font-size: 15px;
  color: var(--am-text-secondary);
  margin-bottom: 12px;
}

.album-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
