<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero
      title="Playlists"
      :subtitle="`${playlists.playlists.length} playlists`"
      view-toggle
    >
      <template v-slot:actions v-if="session.canEditPlaylists">
        <q-btn flat icon="download" label="Import Spotify playlist" @click="spotifyImportOpen = true" />
        <q-btn unelevated color="primary" icon="add" label="New playlist" @click="onCreate" />
      </template>
    </PageHero>

    <ListFilter v-model="filter" placeholder="Filter playlists" />

    <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
      {{ error }}
    </q-banner>

    <PlaylistList
      :playlists="filteredPlaylists"
      :empty-label="filter ? `No playlists match '${filter}'.` : 'No playlists yet. Tap “New playlist” to create one.'"
      @menu-action="onMenuAction"
    />

    <ImportSpotifyPlaylistDialog v-if="session.canEditPlaylists" v-model="spotifyImportOpen" @imported="onImported" />

    <q-dialog v-model="storageDialogOpen">
      <q-card class="playlist-dialog">
        <q-card-section>
          <div class="text-h6">Playlist Storage</div>
          <div class="text-caption text-grey-5">
            Source tracks are mirrored to the selected source. Other tracks stay in jmmp.
          </div>
        </q-card-section>
        <q-card-section>
          <q-option-group
            v-model="selectedStorageSource"
            :options="storageOptions"
            type="radio"
            dense
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn unelevated color="primary" label="Save" @click="saveStorage" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="infoOpen">
      <q-card class="playlist-info-card">
        <q-card-section>
          <div class="text-h6">{{ targetPlaylist?.name }}</div>
          <div class="text-caption text-grey-5">{{ targetPlaylist?.storage.label }}</div>
        </q-card-section>
        <q-separator />
        <q-card-section v-if="targetPlaylist">
          <div class="info-grid">
            <div class="info-label">Tracks</div>
            <div class="info-value">{{ targetPlaylist.trackCount }}</div>
            <div class="info-label">Storage</div>
            <div class="info-value">{{ targetPlaylist.storage.label }}</div>
            <div class="info-label">Created</div>
            <div class="info-value">{{ formatDate(targetPlaylist.createdAt) }}</div>
            <div class="info-label">Updated</div>
            <div class="info-value">{{ formatDate(targetPlaylist.updatedAt) }}</div>
            <template v-if="targetPlaylist.pinnedAt">
              <div class="info-label">Pinned</div>
              <div class="info-value">{{ formatDate(targetPlaylist.pinnedAt) }}</div>
            </template>
            <template v-if="targetPlaylist.storage.sourceName">
              <div class="info-label">Source</div>
              <div class="info-value">{{ targetPlaylist.storage.sourceName }}</div>
              <div class="info-label">Source playlist ID</div>
              <div class="info-value">{{ targetPlaylist.storage.sourcePlaylistId }}</div>
            </template>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { useSessionStore } from "src/stores/session";
const session = useSessionStore();
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { usePlaylistsStore } from "src/stores/playlists";
import { useSourcesStore } from "src/stores/sources";
import PageHero from "src/components/PageHero.vue";
import ListFilter from "src/components/ListFilter.vue";
import ImportSpotifyPlaylistDialog from "src/components/ImportSpotifyPlaylistDialog.vue";
import PlaylistList, {
  type PlaylistMenuAction,
} from "src/components/PlaylistList.vue";
import type { Playlist } from "@jmmp/shared";

const playlists = usePlaylistsStore();
const sources = useSourcesStore();
const router = useRouter();
const error = ref<string | null>(null);
const filter = ref("");
const targetPlaylist = ref<Playlist | null>(null);
const infoOpen = ref(false);
const storageDialogOpen = ref(false);
const spotifyImportOpen = ref(false);
const selectedStorageSource = ref<number | "local">("local");

onMounted(async () => {
  try {
    await playlists.load();
    if (!sources.loaded) await sources.load().catch(() => {});
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

const filteredPlaylists = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return playlists.playlists;
  return playlists.playlists.filter((p) => p.name.toLowerCase().includes(q));
});

const storageOptions = computed(() => [
  { label: "jmmp server", value: "local" as const },
  ...sources.sources
    .filter((source) => source.kind === "qobuz")
    .map((source) => ({ label: source.name, value: source.id })),
]);

async function onImported(playlist: Playlist): Promise<void> {
  await router.push({ name: "playlist", params: { id: String(playlist.id) } });
}

async function onCreate(): Promise<void> {
  const name = window.prompt("Playlist name:");
  if (!name?.trim()) return;
  try {
    const p = await playlists.create(name.trim());
    await router.push({ name: "playlist", params: { id: String(p.id) } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function onMenuAction(
  action: PlaylistMenuAction,
  playlist: Playlist
): Promise<void> {
  targetPlaylist.value = playlist;
  switch (action) {
    case "open":
      await router.push({ name: "playlist", params: { id: String(playlist.id) } });
      break;
    case "info":
      infoOpen.value = true;
      break;
    case "rename":
      await renameTarget(playlist);
      break;
    case "delete":
      await deleteTarget(playlist);
      break;
    case "storage":
      selectedStorageSource.value = playlist.storage.sourceId ?? "local";
      storageDialogOpen.value = true;
      break;
  }
}

async function renameTarget(playlist: Playlist): Promise<void> {
  const name = window.prompt("Playlist name:", playlist.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    await playlists.rename(playlist.id, trimmed);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function deleteTarget(playlist: Playlist): Promise<void> {
  if (!window.confirm(`Delete "${playlist.name}"?`)) return;
  try {
    await playlists.remove(playlist.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function saveStorage(): Promise<void> {
  const playlist = targetPlaylist.value;
  if (!playlist) return;
  try {
    const sourceId =
      selectedStorageSource.value === "local" ? null : selectedStorageSource.value;
    await playlists.setStorage(playlist.id, sourceId);
    storageDialogOpen.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}
</script>

<style scoped>
.playlist-info-card,
.playlist-dialog {
  width: min(520px, calc(100vw - 32px));
  background: #1d2027;
  color: var(--am-text-primary);
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
