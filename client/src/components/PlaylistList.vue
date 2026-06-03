<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div :class="effectiveMode === 'list' ? 'playlist-list' : 'playlist-grid'">
    <button
      v-for="p in playlists"
      :key="p.id"
      :class="effectiveMode === 'list' ? 'playlist-row' : 'playlist-card'"
      @click="onClick($event, p)"
      @contextmenu.prevent.stop="menuTrigger.onContextMenu($event, p)"
      @pointerdown="menuTrigger.onPointerDown($event, p)"
      @pointermove="menuTrigger.onPointerMove"
      @pointerup="menuTrigger.onPointerEnd"
      @pointercancel="menuTrigger.onPointerEnd"
    >
      <div :class="effectiveMode === 'list' ? 'playlist-row-art' : 'playlist-art'">
        <q-icon
          name="queue_music"
          :size="effectiveMode === 'list' ? '24px' : '48px'"
        />
      </div>
      <div
        :class="effectiveMode === 'list' ? 'playlist-row-meta' : 'playlist-meta'"
      >
        <div
          :class="effectiveMode === 'list' ? 'playlist-row-name' : 'playlist-name'"
        >
          {{ p.name }}
        </div>
        <div
          :class="effectiveMode === 'list' ? 'playlist-row-sub' : 'playlist-count'"
        >
          {{ p.trackCount }} tracks
          <span
            v-if="effectiveMode === 'grid' || compact"
            :class="effectiveMode === 'list' ? 'playlist-row-storage' : 'playlist-storage'"
          >
            · {{ p.storage.label }}
          </span>
        </div>
        <div
          v-if="effectiveMode === 'grid'"
          class="playlist-storage"
        >
          {{ p.storage.label }}
        </div>
      </div>
      <div v-if="effectiveMode === 'list'" class="playlist-row-actions">
        <q-btn
          flat
          round
          dense
          :icon="p.pinnedAt ? 'push_pin' : 'push_pin_outlined'"
          :class="['playlist-row-pin', { pinned: p.pinnedAt !== null }]"
          :aria-label="p.pinnedAt ? `Unpin ${p.name}` : `Pin ${p.name}`"
          @click.stop="onTogglePin(p)"
        />
        <q-btn
          flat
          round
          dense
          icon="play_arrow"
          class="playlist-row-play"
          :disable="p.trackCount === 0"
          :aria-label="`Play ${p.name}`"
          @click.stop="onRowPlay(p)"
        />
      </div>
      <q-icon
        v-else-if="p.pinnedAt"
        name="push_pin"
        size="14px"
        class="playlist-card-pin"
      />
    </button>
    <div
      v-if="playlists.length === 0"
      :class="effectiveMode === 'list' ? 'playlist-list-empty' : 'playlist-grid-empty'"
    >
      {{ emptyLabel ?? "No playlists yet." }}
    </div>
    <q-menu ref="contextMenu" touch-position>
      <q-list dense style="min-width: 200px">
        <q-item-label header>{{ menuTarget?.name ?? "Playlist" }}</q-item-label>
        <q-item clickable v-close-popup @click="emitAction('open')">
          <q-item-section avatar><q-icon name="open_in_new" /></q-item-section>
          <q-item-section>Open</q-item-section>
        </q-item>
        <q-item
          clickable
          v-close-popup
          :disable="!menuTarget || menuTarget.trackCount === 0"
          @click="menuTarget && onRowPlay(menuTarget)"
        >
          <q-item-section avatar><q-icon name="play_arrow" /></q-item-section>
          <q-item-section>Play</q-item-section>
        </q-item>
        <q-separator />
        <q-item clickable v-close-popup @click="menuTarget && onTogglePin(menuTarget)">
          <q-item-section avatar>
            <q-icon :name="menuTarget?.pinnedAt ? 'push_pin' : 'push_pin_outlined'" />
          </q-item-section>
          <q-item-section>
            {{ menuTarget?.pinnedAt ? "Unpin" : "Pin to top" }}
          </q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="emitAction('info')">
          <q-item-section avatar><q-icon name="info" /></q-item-section>
          <q-item-section>Info</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="emitAction('rename')">
          <q-item-section avatar><q-icon name="edit" /></q-item-section>
          <q-item-section>Rename</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="emitAction('storage')">
          <q-item-section avatar><q-icon name="cloud_sync" /></q-item-section>
          <q-item-section>Storage</q-item-section>
        </q-item>
        <q-separator />
        <q-item clickable v-close-popup @click="emitAction('delete')">
          <q-item-section avatar><q-icon name="delete" /></q-item-section>
          <q-item-section class="text-red-5">Delete</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { Playlist } from "@jmmp/shared";
import { usePlaylistsStore } from "src/stores/playlists";
import { useSettingsStore } from "src/stores/settings";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import { usePressContextMenu } from "src/interactions/press-context-menu";

export type PlaylistMenuAction = "open" | "info" | "rename" | "delete" | "storage";

const props = defineProps<{
  playlists: Playlist[];
  emptyLabel?: string;
  forceMode?: "list" | "grid";
  compact?: boolean;
}>();

const emit = defineEmits<{
  select: [playlist: Playlist];
  menuAction: [action: PlaylistMenuAction, playlist: Playlist];
}>();

const router = useRouter();
const playlists = usePlaylistsStore();
const settings = useSettingsStore();
const queue = useQueueStore();
const player = usePlayerStore();
const contextMenu = ref<{ show: (evt?: Event) => void } | null>(null);
const menuTarget = ref<Playlist | null>(null);

const effectiveMode = computed<"list" | "grid">(
  () => props.forceMode ?? settings.settings.libraryView
);

const menuTrigger = usePressContextMenu<Playlist>({
  keyFor: (p) => p.id,
  open: (event, playlist) => {
    menuTarget.value = playlist;
    contextMenu.value?.show(event);
  },
});

function onClick(event: MouseEvent, playlist: Playlist): void {
  if (menuTrigger.consumeClick(event, playlist)) return;
  emit("select", playlist);
  void router.push({ name: "playlist", params: { id: String(playlist.id) } });
}

async function onTogglePin(p: Playlist): Promise<void> {
  try {
    await playlists.setPinned(p.id, p.pinnedAt === null);
  } catch {
    /* ignore */
  }
}

async function onRowPlay(p: Playlist): Promise<void> {
  if (p.trackCount === 0) return;
  try {
    const full = await playlists.get(p.id);
    if (full.tracks.length === 0) return;
    const first = await queue.playFromTracks(full.tracks, 0);
    if (first) await player.play(first);
  } catch {
    /* ignore */
  }
}

function emitAction(action: PlaylistMenuAction): void {
  if (menuTarget.value) emit("menuAction", action, menuTarget.value);
}
</script>

<style scoped>
.playlist-list {
  display: flex;
  flex-direction: column;
  padding: 4px 8px 24px;
}

@media (min-width: 600px) {
  .playlist-list {
    padding: 8px 24px 32px;
  }
}

.playlist-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: none;
  padding: 6px 8px;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  min-height: 56px;
}

.playlist-row:hover {
  background: var(--am-row-hover);
}

.playlist-row-art {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3a2e4a, #1a1c22);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.55);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.playlist-row-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.playlist-row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--am-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-row-sub {
  font-size: 12px;
  color: var(--am-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-row-storage {
  color: var(--am-text-muted);
}

.playlist-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.playlist-row-pin {
  color: var(--am-text-muted);
}

.playlist-row-pin.pinned {
  color: #ff6b87;
}

.playlist-row-play {
  color: var(--am-text-secondary);
}

.playlist-row-play:hover {
  color: #ff6b87;
}

.playlist-list-empty {
  padding: 32px;
  text-align: center;
  color: var(--am-text-muted);
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 24px;
  padding: 24px 32px 32px;
}

.playlist-card {
  background: transparent;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
  position: relative;
}

.playlist-art {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  background: linear-gradient(135deg, #3a2e4a, #1a1c22);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: transform 160ms ease;
}

.playlist-card:hover .playlist-art {
  transform: translateY(-2px);
}

.playlist-meta {
  margin-top: 8px;
}

.playlist-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--am-text-primary);
}

.playlist-count {
  font-size: 12px;
  color: var(--am-text-secondary);
}

.playlist-storage {
  margin-top: 2px;
  font-size: 11px;
  color: var(--am-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-card-pin {
  position: absolute;
  top: 6px;
  right: 6px;
  color: #ff6b87;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 50%;
  padding: 3px;
}

.playlist-grid-empty {
  grid-column: 1 / -1;
  padding: 32px;
  text-align: center;
  color: var(--am-text-muted);
}
</style>
