<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-menu
    ref="menu"
    touch-position
    no-parent-event
    content-class="library-object-menu"
  >
    <q-list dense class="library-object-menu-list">
      <q-item-label header class="ellipsis">{{ menuTitle }}</q-item-label>
      <q-item v-if="context?.open" clickable v-close-popup @click="openContext">
        <q-item-section avatar><q-icon name="open_in_new" /></q-item-section>
        <q-item-section>Open</q-item-section>
      </q-item>
      <q-item clickable v-close-popup :disable="actionBusy" @click="playNow">
        <q-item-section avatar><q-icon name="play_arrow" /></q-item-section>
        <q-item-section>Play</q-item-section>
      </q-item>
      <q-item clickable v-close-popup :disable="actionBusy" @click="addToQueue">
        <q-item-section avatar><q-icon name="queue_music" /></q-item-section>
        <q-item-section>Add to queue</q-item-section>
      </q-item>
      <q-separator />
      <q-item clickable v-close-popup @click="playlistPickerOpen = true">
        <q-item-section avatar><q-icon name="playlist_add" /></q-item-section>
        <q-item-section>{{ playlistLabel }}…</q-item-section>
      </q-item>
      <q-separator />
      <q-item clickable v-close-popup @click="showInfo">
        <q-item-section avatar><q-icon name="info" /></q-item-section>
        <q-item-section>Info</q-item-section>
      </q-item>
    </q-list>
  </q-menu>

  <q-dialog v-model="infoOpen">
    <q-card class="library-info-card">
      <q-card-section>
        <div class="library-info-heading">
          <q-icon :name="context?.icon ?? 'info'" size="24px" />
          <div>
            <div class="text-h6">{{ context?.title ?? "Library item" }}</div>
            <div class="text-caption text-grey-5">
              {{ context?.subtitle ?? context?.kind ?? "" }}
            </div>
          </div>
        </div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <div class="info-grid">
          <template v-for="row in infoRows" :key="row.label">
            <div class="info-label">{{ row.label }}</div>
            <div class="info-value">{{ row.value }}</div>
          </template>
          <div class="info-label">Tracks</div>
          <div class="info-value">
            <q-spinner v-if="infoLoading" size="14px" />
            <span v-else>{{ infoTrackCount ?? "-" }}</span>
          </div>
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Close" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <PlaylistPickerDialog
    v-model="playlistPickerOpen"
    :title="playlistLabel"
    :busy="actionBusy"
    @selected="addToPlaylist"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import { usePlaylistsStore } from "src/stores/playlists";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import type { LibraryMenuContext } from "src/library/context-menu";
import { definedInfoRows } from "src/library/context-menu";
import type { Playlist, Track } from "@jmmp/shared";
import PlaylistPickerDialog from "./PlaylistPickerDialog.vue";

const $q = useQuasar();
const playlists = usePlaylistsStore();
const queue = useQueueStore();
const player = usePlayerStore();
const menu = ref<{ show: (evt?: Event) => void } | null>(null);
const context = ref<LibraryMenuContext | null>(null);
const infoOpen = ref(false);
const infoLoading = ref(false);
const infoTrackCount = ref<number | null>(null);
const cachedTracks = ref<Track[] | null>(null);
const actionBusy = ref(false);
const playlistPickerOpen = ref(false);
let trackRequestId = 0;

const menuTitle = computed(() => context.value?.title ?? "Library item");
const playlistLabel = computed(
  () => context.value?.playlistLabel ?? "Add to playlist"
);
const infoRows = computed(() => definedInfoRows(context.value?.infoRows ?? []));

function show(event: Event, nextContext: LibraryMenuContext): void {
  context.value = nextContext;
  cachedTracks.value = null;
  infoTrackCount.value = null;
  actionBusy.value = false;
  playlistPickerOpen.value = false;
  trackRequestId++;
  menu.value?.show(event);
}

function openContext(): void {
  context.value?.open?.();
}

async function playNow(): Promise<void> {
  actionBusy.value = true;
  try {
    const tracks = await resolveTracks();
    if (tracks.length === 0) return;
    const first = await queue.playFromTracks(tracks, 0);
    if (first) await player.play(first);
  } catch (err) {
    notifyError(err);
  } finally {
    actionBusy.value = false;
  }
}

async function addToQueue(): Promise<void> {
  actionBusy.value = true;
  try {
    const tracks = await resolveTracks();
    if (tracks.length === 0) return;
    await queue.append(tracks.map((track) => track.id));
    notifySuccess(`${trackCountLabel(tracks.length)} added to the queue`);
  } catch (err) {
    notifyError(err);
  } finally {
    actionBusy.value = false;
  }
}

function showInfo(): void {
  infoOpen.value = true;
  void loadInfoTrackCount();
}

async function loadInfoTrackCount(): Promise<void> {
  infoLoading.value = true;
  try {
    infoTrackCount.value = (await resolveTracks()).length;
  } catch (err) {
    notifyError(err);
  } finally {
    infoLoading.value = false;
  }
}

async function addToPlaylist(playlist: Playlist): Promise<void> {
  actionBusy.value = true;
  try {
    const trackIds = (await resolveTracks()).map((track) => track.id);
    if (trackIds.length === 0) return;
    await playlists.append(playlist.id, trackIds);
    playlistPickerOpen.value = false;
    notifySuccess(`${trackCountLabel(trackIds.length)} added to “${playlist.name}”`);
  } catch (err) {
    notifyError(err);
  } finally {
    actionBusy.value = false;
  }
}

async function resolveTracks(): Promise<Track[]> {
  const currentContext = context.value;
  if (!currentContext) return [];
  if (cachedTracks.value) return cachedTracks.value;
  const requestId = ++trackRequestId;
  const tracks = await currentContext.loadTracks();
  if (context.value === currentContext && requestId === trackRequestId) {
    cachedTracks.value = tracks;
  }
  return tracks;
}

function trackCountLabel(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

function notifySuccess(message: string): void {
  $q.notify({ type: "positive", message, timeout: 2200 });
}

function notifyError(err: unknown): void {
  $q.notify({
    type: "negative",
    message: err instanceof Error ? err.message : String(err),
  });
}

defineExpose({ show });
</script>

<style scoped>
.library-info-card {
  width: min(520px, calc(100vw - 32px));
  background: #1d2027;
  color: var(--am-text-primary);
}

:global(.library-object-menu) {
  width: min(290px, calc(100vw - 24px));
  max-width: min(290px, calc(100vw - 24px));
}

.library-object-menu-list {
  min-width: 250px;
}

.library-info-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.info-grid {
  display: grid;
  grid-template-columns: minmax(120px, 0.35fr) minmax(0, 1fr);
  gap: 8px 16px;
}

.info-label {
  color: var(--am-text-muted);
  font-size: 12px;
}

.info-value {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: var(--am-text-secondary);
}
</style>
