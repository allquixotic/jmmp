<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-dialog
    v-model="model"
    :position="dialogPosition"
    :persistent="busy"
    @hide="onHide"
  >
    <q-card class="playlist-picker" :aria-busy="busy">
      <q-linear-progress v-if="busy" indeterminate color="primary" />

      <q-card-section class="playlist-picker-heading row items-center no-wrap">
        <div class="col">
          <div class="text-h6">{{ title ?? "Choose a playlist" }}</div>
          <div class="text-caption text-grey-5">
            {{ busy ? "Updating playlist…" : "Select a destination" }}
          </div>
        </div>
        <q-btn
          v-close-popup
          flat
          round
          dense
          icon="close"
          aria-label="Close playlist picker"
          :disable="busy"
        />
      </q-card-section>

      <q-card-section class="q-pt-none q-pb-sm">
        <q-input
          v-model="query"
          autofocus
          clearable
          dense
          outlined
          color="primary"
          placeholder="Search playlists"
          aria-label="Search playlists"
          :disable="loading"
        >
          <template #prepend>
            <q-icon name="search" size="20px" />
          </template>
        </q-input>
      </q-card-section>

      <q-separator />

      <div class="playlist-picker-results">
        <div
          v-if="loading"
          class="playlist-picker-state"
          role="status"
          aria-live="polite"
        >
          <q-spinner color="primary" size="28px" />
          <span>Loading playlists…</span>
        </div>

        <div v-else-if="loadError" class="playlist-picker-state" role="alert">
          <q-icon name="cloud_off" size="30px" color="negative" />
          <div>
            <div class="text-weight-medium">Couldn’t load playlists</div>
            <div class="text-caption text-grey-5">{{ loadError }}</div>
          </div>
          <q-btn
            flat
            color="primary"
            icon="refresh"
            label="Retry"
            :disable="busy"
            @click="loadPlaylists"
          />
        </div>

        <div v-else-if="availablePlaylists.length === 0" class="playlist-picker-state">
          <q-icon name="queue_music" size="32px" />
          <div>
            <div class="text-weight-medium">No playlists available</div>
            <div class="text-caption text-grey-5">
              {{ emptyMessage }}
            </div>
          </div>
        </div>

        <div v-else-if="visiblePlaylists.length === 0" class="playlist-picker-state">
          <q-icon name="search_off" size="32px" />
          <div>
            <div class="text-weight-medium">No matching playlists</div>
            <div class="text-caption text-grey-5">
              Try a different name or clear the search.
            </div>
          </div>
          <q-btn flat color="primary" label="Clear search" @click="query = ''" />
        </div>

        <q-list v-else separator>
          <q-item
            v-for="playlist in visiblePlaylists"
            :key="playlist.id"
            v-ripple
            clickable
            :data-playlist-id="playlist.id"
            :disable="busy"
            @click="selectPlaylist(playlist)"
          >
            <q-item-section avatar>
              <q-icon
                :name="playlist.pinnedAt ? 'push_pin' : 'queue_music'"
                :color="playlist.pinnedAt ? 'primary' : undefined"
                size="21px"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label lines="1">{{ playlist.name }}</q-item-label>
              <q-item-label caption>
                {{ trackCountLabel(playlist.trackCount) }} · {{ playlist.storage.label }}
              </q-item-label>
            </q-item-section>
            <q-item-section v-if="playlist.pinnedAt" side>
              <span class="playlist-picker-pinned">Pinned</span>
            </q-item-section>
            <q-item-section side>
              <q-icon name="chevron_right" size="20px" />
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <q-separator />
      <q-card-actions align="right">
        <q-btn v-close-popup flat label="Cancel" :disable="busy" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import type { Playlist } from "@jmmp/shared";
import { computed, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { playlistPickerResults } from "src/playlists/picker";
import { usePlaylistsStore } from "src/stores/playlists";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    excludedPlaylistId?: number | null;
    busy?: boolean;
  }>(),
  {
    title: undefined,
    excludedPlaylistId: null,
    busy: false,
  }
);

const emit = defineEmits<{
  "update:modelValue": [open: boolean];
  selected: [playlist: Playlist];
}>();

const $q = useQuasar();
const playlists = usePlaylistsStore();
const query = ref("");
const loading = ref(false);
const loadError = ref<string | null>(null);

const model = computed({
  get: () => props.modelValue,
  set: (open: boolean) => emit("update:modelValue", open),
});
const dialogPosition = computed<"bottom" | "standard">(() =>
  $q.screen.lt.md ? "bottom" : "standard"
);
const availablePlaylists = computed(() =>
  playlistPickerResults(playlists.playlists, "", props.excludedPlaylistId)
);
const visiblePlaylists = computed(() =>
  playlistPickerResults(playlists.playlists, query.value, props.excludedPlaylistId)
);
const emptyMessage = computed(() =>
  playlists.playlists.length === 0
    ? "Create a playlist first, then it will appear here."
    : "There are no other playlists to choose from."
);

watch(
  () => props.modelValue,
  (open) => {
    if (open) void loadPlaylists();
  },
  { immediate: true }
);

async function loadPlaylists(): Promise<void> {
  if (loading.value || playlists.loaded) {
    loadError.value = null;
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    await playlists.load();
  } catch (error) {
    loadError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function selectPlaylist(playlist: Playlist): void {
  if (props.busy) return;
  emit("selected", playlist);
}

function onHide(): void {
  query.value = "";
  loadError.value = null;
}

function trackCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "track" : "tracks"}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
</script>

<style scoped>
.playlist-picker {
  display: flex;
  flex-direction: column;
  width: min(520px, calc(100vw - 32px));
  max-width: 100%;
  max-height: min(680px, calc(100vh - 64px));
  background: #1d2027;
  color: var(--am-text-primary);
}

.playlist-picker-heading {
  min-height: 72px;
}

.playlist-picker-results {
  min-height: 220px;
  max-height: min(440px, 52vh);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.playlist-picker-state {
  min-height: 220px;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--am-text-secondary);
  text-align: center;
}

.playlist-picker-pinned {
  color: var(--am-text-muted);
  font-size: 11px;
}

@media (max-width: 1023px) {
  .playlist-picker {
    width: 100vw;
    max-height: 82vh;
    border-radius: 16px 16px 0 0;
  }

  .playlist-picker-results {
    max-height: 52vh;
  }
}
</style>
