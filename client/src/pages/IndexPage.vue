<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page class="home-page">
    <PageHero
      eyebrow="Welcome back"
      title="Home"
      subtitle="Recently added and recently played."
    />

    <section v-if="recentAlbums.length > 0" class="home-section">
      <h2 class="home-section-title">Recently Added</h2>
      <AlbumGrid :albums="recentAlbums" @select="openAlbum" />
    </section>

    <section v-if="recentTracks.length > 0" class="home-section">
      <h2 class="home-section-title">Recently Played</h2>
      <TrackList
        :tracks="recentTracks"
        :playing-track-id="player.current?.id ?? null"
        @play="play"
      />
    </section>

    <section v-if="recentAlbums.length === 0 && recentTracks.length === 0" class="home-empty">
      <PageHero title="Start by adding a source" eyebrow="Welcome" />
      <div class="home-empty-cta">
        <q-btn unelevated color="primary" label="Manage sources" :to="{ name: 'sources' }" />
      </div>
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useCatalogStore } from "src/stores/catalog";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import type { Album, Track } from "@jmmp/shared";
import AlbumGrid from "src/components/AlbumGrid.vue";
import TrackList from "src/components/TrackList.vue";
import PageHero from "src/components/PageHero.vue";

const router = useRouter();
const catalog = useCatalogStore();
const queue = useQueueStore();
const player = usePlayerStore();

const recentAlbums = ref<Album[]>([]);
const recentTracks = ref<Track[]>([]);

onMounted(async () => {
  try {
    const albums = await catalog.loadAlbums();
    recentAlbums.value = albums.slice(0, 12);
  } catch {
    /* ignore */
  }
});

async function play(t: Track): Promise<void> {
  await queue.replace([t.id]);
  queue.index = 0;
  await player.play(t);
}

async function openAlbum(a: Album): Promise<void> {
  await router.push({ name: "browse", query: { album: a.title, artist: a.artist } });
}
</script>

<style scoped>
.home-section {
  margin-top: 24px;
}

.home-section-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  padding: 0 32px;
  color: var(--am-text-primary);
}

.home-empty {
  padding: 48px;
  text-align: center;
}

.home-empty-cta {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}
</style>
