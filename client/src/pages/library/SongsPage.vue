<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero title="Songs" :subtitle="`${tracks.length} songs`" />
    <TrackList
      :tracks="tracks"
      :playing-track-id="player.current?.id ?? null"
      link-metadata
      @play="play"
      @view-artist="openTrackArtist"
      @view-album="openTrackAlbum"
    />
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "src/api";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import type { Track, TrackListResponse } from "@jmmp/shared";
import PageHero from "src/components/PageHero.vue";
import TrackList from "src/components/TrackList.vue";

const queue = useQueueStore();
const player = usePlayerStore();
const router = useRouter();
const tracks = ref<Track[]>([]);

onMounted(async () => {
  try {
    const resp = await api.get<TrackListResponse>("/api/catalog/tracks");
    tracks.value = resp.tracks;
  } catch {
    /* ignore */
  }
});

async function play(_t: Track, i: number): Promise<void> {
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
