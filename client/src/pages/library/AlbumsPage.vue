<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero
      title="Albums"
      :subtitle="`${filteredAlbums.length} of ${albums.length} albums`"
      view-toggle
    />
    <ListFilter v-model="filter" placeholder="Filter albums" />
    <AlbumGrid :albums="filteredAlbums" @select="onSelect" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useCatalogStore } from "src/stores/catalog";
import type { Album } from "@jmmp/shared";
import PageHero from "src/components/PageHero.vue";
import ListFilter from "src/components/ListFilter.vue";
import AlbumGrid from "src/components/AlbumGrid.vue";

const catalog = useCatalogStore();
const router = useRouter();
const albums = ref<Album[]>([]);
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
  } catch {
    /* ignore */
  }
});

function onSelect(a: Album): void {
  void router.push({
    name: "album",
    query: {
      album: a.title,
      artist: a.albumArtist || a.artist,
      source: String(a.sourceId),
    },
  });
}
</script>
