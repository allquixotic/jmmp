<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-menu ref="menu" touch-position no-parent-event @before-show="ensurePlaylists">
    <q-list dense style="min-width: 230px">
      <q-item-label header>{{ menuTitle }}</q-item-label>
      <q-item clickable v-close-popup @click="showInfo">
        <q-item-section avatar><q-icon name="info" /></q-item-section>
        <q-item-section>Info</q-item-section>
      </q-item>
      <q-separator />
      <q-expansion-item
        dense
        default-opened
        expand-separator
        icon="playlist_add"
        :label="playlistLabel"
      >
        <q-list dense>
          <q-item
            v-for="playlist in sortedPlaylists"
            :key="playlist.id"
            clickable
            v-close-popup
            @click="addToPlaylist(playlist.id)"
          >
            <q-item-section>{{ playlist.name }}</q-item-section>
          </q-item>
          <q-item v-if="playlists.loaded && sortedPlaylists.length === 0">
            <q-item-section class="text-grey-6">No playlists</q-item-section>
          </q-item>
        </q-list>
      </q-expansion-item>
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
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import { usePlaylistsStore } from "src/stores/playlists";
import { sortPlaylists } from "src/playlists/sort";
import type { LibraryMenuContext } from "src/library/context-menu";
import { definedInfoRows } from "src/library/context-menu";

const $q = useQuasar();
const playlists = usePlaylistsStore();
const menu = ref<{ show: (evt?: Event) => void } | null>(null);
const context = ref<LibraryMenuContext | null>(null);
const infoOpen = ref(false);
const infoLoading = ref(false);
const infoTrackCount = ref<number | null>(null);
const cachedTrackIds = ref<number[] | null>(null);
let trackRequestId = 0;

const sortedPlaylists = computed(() => sortPlaylists(playlists.playlists));
const menuTitle = computed(() => context.value?.title ?? "Library item");
const playlistLabel = computed(
  () => context.value?.playlistLabel ?? "Add to playlist"
);
const infoRows = computed(() => definedInfoRows(context.value?.infoRows ?? []));

async function ensurePlaylists(): Promise<void> {
  if (playlists.loaded) return;
  try {
    await playlists.load();
  } catch (err) {
    notifyError(err);
  }
}

function show(event: Event, nextContext: LibraryMenuContext): void {
  context.value = nextContext;
  cachedTrackIds.value = null;
  infoTrackCount.value = null;
  trackRequestId++;
  menu.value?.show(event);
}

function showInfo(): void {
  infoOpen.value = true;
  void loadInfoTrackCount();
}

async function loadInfoTrackCount(): Promise<void> {
  infoLoading.value = true;
  try {
    infoTrackCount.value = (await resolveTrackIds()).length;
  } catch (err) {
    notifyError(err);
  } finally {
    infoLoading.value = false;
  }
}

async function addToPlaylist(playlistId: number): Promise<void> {
  try {
    const trackIds = await resolveTrackIds();
    if (trackIds.length === 0) return;
    await playlists.append(playlistId, trackIds);
  } catch (err) {
    notifyError(err);
  }
}

async function resolveTrackIds(): Promise<number[]> {
  const currentContext = context.value;
  if (!currentContext) return [];
  if (cachedTrackIds.value) return cachedTrackIds.value;
  const requestId = ++trackRequestId;
  const trackIds = (await currentContext.loadTracks()).map((track) => track.id);
  if (context.value === currentContext && requestId === trackRequestId) {
    cachedTrackIds.value = trackIds;
  }
  return trackIds;
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
