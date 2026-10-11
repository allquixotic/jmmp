<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div :class="mode === 'list' ? 'album-list' : 'album-grid'">
    <button
      v-for="album in albums"
      :key="album.id"
      :class="mode === 'list' ? 'album-row' : 'album-card'"
      @click="onAlbumClick($event, album)"
      @contextmenu.prevent.stop="albumMenuTrigger.onContextMenu($event, album)"
      @pointerdown="albumMenuTrigger.onPointerDown($event, album)"
      @pointermove="albumMenuTrigger.onPointerMove"
      @pointerup="albumMenuTrigger.onPointerEnd"
      @pointercancel="albumMenuTrigger.onPointerEnd"
      @keydown="albumMenuTrigger.onKeyDown($event, album)"
    >
      <AlbumCover
        :hash="album.artHash"
        :alt="album.title"
        :size="mode === 'list' ? 48 : undefined"
      />
      <div :class="mode === 'list' ? 'album-row-meta' : 'album-card-meta'">
        <div :class="mode === 'list' ? 'album-row-title' : 'album-card-title'">
          {{ album.title || "Untitled" }}
        </div>
        <div :class="mode === 'list' ? 'album-row-artist' : 'album-card-artist'">
          {{ album.artist || "" }}
        </div>
      </div>
      <q-btn
        v-if="mode === 'list'"
        flat
        round
        dense
        class="album-row-play"
        icon="play_arrow"
        :aria-label="`Play ${album.title}`"
        @click.stop="onRowPlay(album)"
      />
    </button>
    <div
      v-if="albums.length === 0"
      :class="mode === 'list' ? 'album-list-empty' : 'album-grid-empty'"
    >
      {{ emptyLabel ?? "Nothing to show." }}
    </div>
    <LibraryObjectMenu ref="albumMenu" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { Album } from "@jmmp/shared";
import { useCatalogStore } from "src/stores/catalog";
import { useSourcesStore } from "src/stores/sources";
import { useSettingsStore } from "src/stores/settings";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import { usePressContextMenu } from "src/interactions/press-context-menu";
import type {
  LibraryMenuContext,
  LibraryInfoRow,
} from "src/library/context-menu";
import AlbumCover from "./AlbumCover.vue";
import LibraryObjectMenu from "./LibraryObjectMenu.vue";

defineProps<{ albums: Album[]; emptyLabel?: string }>();
const emit = defineEmits<{ select: [album: Album] }>();

const catalog = useCatalogStore();
const sources = useSourcesStore();
const settings = useSettingsStore();
const queue = useQueueStore();
const player = usePlayerStore();
const albumMenu = ref<{
  show: (event: Event, context: LibraryMenuContext) => void;
} | null>(null);

const mode = computed<"list" | "grid">(() => settings.settings.libraryView);

onMounted(() => {
  if (!sources.loaded) void sources.load().catch(() => {});
});

const albumMenuTrigger = usePressContextMenu<Album>({
  keyFor: (album) => album.id,
  open: (event, album) => {
    albumMenu.value?.show(event, albumContext(album));
  },
});

function onAlbumClick(event: MouseEvent, album: Album): void {
  if (albumMenuTrigger.consumeClick(event, album)) return;
  emit("select", album);
}

async function onRowPlay(album: Album): Promise<void> {
  try {
    const tracks = await catalog.loadTracks(
      album.title,
      album.albumArtist || album.artist || undefined,
      album.sourceId
    );
    if (tracks.length === 0) return;
    const first = await queue.playFromTracks(tracks, 0);
    if (first) await player.play(first);
  } catch {
    /* ignore */
  }
}

function albumContext(album: Album): LibraryMenuContext {
  return {
    kind: "Album",
    title: album.title || "Untitled album",
    subtitle: album.artist || "Album",
    icon: "album",
    playlistLabel: "Add album to playlist",
    infoRows: albumInfoRows(album),
    open: () => emit("select", album),
    loadTracks: () =>
      catalog.loadTracks(
        album.title,
        album.albumArtist || album.artist || undefined,
        album.sourceId
      ),
  };
}

function albumInfoRows(album: Album): LibraryInfoRow[] {
  return [
    { label: "Type", value: "Album" },
    { label: "Artist", value: album.artist },
    { label: "Album artist", value: album.albumArtist ?? null },
    { label: "Year", value: album.year ?? null },
    { label: "Source", value: sourceName(album.sourceId) },
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
.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
  padding: 14px 16px 24px;
}

@media (min-width: 600px) {
  .album-grid {
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 24px;
    padding: 24px 32px 32px;
  }
}

.album-card {
  background: transparent;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: inherit;
}

.album-card:hover :deep(.album-cover) {
  transform: translateY(-2px);
}

.album-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--am-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-card-artist {
  font-size: 12px;
  color: var(--am-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-grid-empty {
  padding: 32px;
  text-align: center;
  color: var(--am-text-muted);
  grid-column: 1 / -1;
}

.album-list {
  display: flex;
  flex-direction: column;
  padding: 4px 8px 24px;
}

@media (min-width: 600px) {
  .album-list {
    padding: 8px 24px 32px;
  }
}

.album-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: none;
  padding: 6px 8px;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  min-height: 60px;
}

.album-row:hover {
  background: var(--am-row-hover);
}

.album-row :deep(.album-cover) {
  border-radius: 6px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.album-row-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.album-row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--am-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-row-artist {
  font-size: 12px;
  color: var(--am-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-row-play {
  color: var(--am-text-secondary);
}

.album-row-play:hover {
  color: #ff6b87;
}

.album-list-empty {
  padding: 32px;
  text-align: center;
  color: var(--am-text-muted);
}
</style>
