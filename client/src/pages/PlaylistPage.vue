<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <div v-if="playlist" class="playlist-page">
      <header class="playlist-header">
        <div class="playlist-art-large">
          <q-icon name="queue_music" size="80px" />
        </div>
        <div class="playlist-header-text">
          <div class="playlist-header-eyebrow">Playlist</div>
          <div class="playlist-header-title">{{ playlist.name }}</div>
          <div class="playlist-header-meta">
            <span>{{ playlist.tracks.length }} tracks</span>
            <span class="playlist-storage">
              <q-icon name="storage" size="15px" />
              {{ playlist.storage.label }}
            </span>
          </div>
          <div class="playlist-actions">
            <q-btn
              unelevated
              color="primary"
              icon="play_arrow"
              label="Play"
              :disable="playlist.tracks.length === 0"
              @click="playAll"
            />
            <q-btn flat icon="shuffle" label="Shuffle" @click="shuffleAll" />
            <q-btn flat icon="view_column" label="Columns">
              <q-menu>
                <q-list dense style="min-width: 180px">
                  <q-item-label header>Displayed columns</q-item-label>
                  <q-option-group
                    v-model="visibleColumns"
                    :options="columnOptions"
                    type="checkbox"
                    dense
                  />
                </q-list>
              </q-menu>
            </q-btn>
            <q-btn
              v-if="sortKey"
              flat
              dense
              icon="restart_alt"
              label="Manual order"
              @click="clearSort"
            />
            <q-btn flat round dense icon="more_horiz">
              <q-tooltip>Playlist actions</q-tooltip>
              <q-menu>
                <q-list dense style="min-width: 180px">
                  <q-item clickable v-close-popup @click="playlistInfoOpen = true">
                    <q-item-section avatar><q-icon name="info" /></q-item-section>
                    <q-item-section>Info</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup @click="storageDialogOpen = true">
                    <q-item-section avatar><q-icon name="cloud_sync" /></q-item-section>
                    <q-item-section>Storage</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup @click="renamePlaylist">
                    <q-item-section avatar><q-icon name="edit" /></q-item-section>
                    <q-item-section>Rename</q-item-section>
                  </q-item>
                  <q-item clickable v-close-popup @click="deletePlaylist">
                    <q-item-section avatar><q-icon name="delete" /></q-item-section>
                    <q-item-section>Delete</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
        </div>
      </header>
      <TrackList
        :tracks="displayTracks"
        :playing-track-id="player.current?.id ?? null"
        :reorderable="!sortKey && playlist.tracks.length > 1"
        sortable
        :sort-key="sortKey"
        :sort-direction="sortDirection"
        :columns="visibleColumns"
        selectable
        removable
        link-metadata
        :remove-busy="mutationBusy"
        :current-playlist-id="playlist.id"
        :selected-tracks="selectedTracks"
        @play="playAt"
        @select="selectTrack"
        @reorder="reorderTracks"
        @sort="cycleSort"
        @remove="removeTracks"
        @view-artist="openTrackArtist"
        @view-album="openTrackAlbum"
      />

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

      <q-dialog v-model="playlistInfoOpen">
        <q-card class="playlist-dialog">
          <q-card-section>
            <div class="text-h6">{{ playlist.name }}</div>
            <div class="text-caption text-grey-5">{{ playlist.storage.label }}</div>
          </q-card-section>
          <q-separator />
          <q-card-section>
            <div class="info-grid">
              <div class="info-label">Tracks</div>
              <div class="info-value">{{ playlist.tracks.length }}</div>
              <div class="info-label">Storage</div>
              <div class="info-value">{{ playlist.storage.label }}</div>
              <div class="info-label">Created</div>
              <div class="info-value">{{ formatDate(playlist.createdAt) }}</div>
              <div class="info-label">Updated</div>
              <div class="info-value">{{ formatDate(playlist.updatedAt) }}</div>
              <template v-if="playlist.storage.sourceName">
                <div class="info-label">Source</div>
                <div class="info-value">{{ playlist.storage.sourceName }}</div>
                <div class="info-label">Source playlist ID</div>
                <div class="info-value">{{ playlist.storage.sourcePlaylistId }}</div>
              </template>
            </div>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Close" v-close-popup />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>

    <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
      {{ error }}
    </q-banner>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { usePlaylistsStore } from "src/stores/playlists";
import { useQueueStore } from "src/stores/queue";
import { usePlayerStore } from "src/stores/player";
import { useSourcesStore } from "src/stores/sources";
import type { PlaylistWithTracks, Track } from "@jmmp/shared";
import TrackList from "src/components/TrackList.vue";
import { moveItem } from "src/playlists/reorder";
import { removePlaylistOccurrences } from "src/playlists/remove";
import {
  DEFAULT_PLAYLIST_COLUMNS,
  sortTracksByColumn,
  type SortDirection,
  type TrackColumnKey,
  type TrackSortKey,
} from "src/tracks/sort";
import {
  updateOccurrenceSelection,
  type SelectionModifiers,
} from "src/tracks/selection";

const props = defineProps<{ id: string }>();
const playlists = usePlaylistsStore();
const queue = useQueueStore();
const player = usePlayerStore();
const sources = useSourcesStore();
const router = useRouter();
const $q = useQuasar();

const playlist = ref<PlaylistWithTracks | null>(null);
const error = ref<string | null>(null);
const visibleColumns = ref<TrackColumnKey[]>([...DEFAULT_PLAYLIST_COLUMNS]);
const sortKey = ref<TrackSortKey | null>(null);
const sortDirection = ref<SortDirection>("asc");
const storageDialogOpen = ref(false);
const playlistInfoOpen = ref(false);
const selectedStorageSource = ref<number | "local">("local");
const selectedTracks = ref<Track[]>([]);
const selectionAnchor = ref<Track | null>(null);
const mutationBusy = ref(false);

const displayTracks = computed(() => {
  const tracks = playlist.value?.tracks ?? [];
  if (!sortKey.value) return tracks;
  return sortTracksByColumn(tracks, sortKey.value, sortDirection.value, sourceName);
});
const columnOptions = [
  { label: "Artist", value: "artist" },
  { label: "Album", value: "album" },
  { label: "Source", value: "source" },
  { label: "Time", value: "duration" },
  { label: "Codec", value: "codec" },
  { label: "Quality", value: "quality" },
];
const storageOptions = computed(() => [
  { label: "jmmp server", value: "local" },
  ...sources.sources
    .filter((source) => source.kind === "qobuz")
    .map((source) => ({ label: source.name, value: source.id })),
]);

async function load(): Promise<void> {
  try {
    if (!sources.loaded) await sources.load().catch(() => {});
    playlist.value = await playlists.get(parseInt(props.id, 10));
    selectedStorageSource.value = playlist.value.storage.sourceId ?? "local";
    selectedTracks.value = [];
    selectionAnchor.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(load);
watch(() => props.id, load);
watch(displayTracks, (tracks) => {
  selectedTracks.value = selectedTracks.value.filter((track) =>
    tracks.includes(track)
  );
  if (selectionAnchor.value !== null && !tracks.includes(selectionAnchor.value)) {
    selectionAnchor.value = selectedTracks.value[0] ?? null;
  }
});

async function playAll(): Promise<void> {
  if (!playlist.value) return;
  const first = await queue.playFromTracks(displayTracks.value, 0);
  if (first) await player.play(first);
}

async function shuffleAll(): Promise<void> {
  if (!playlist.value) return;
  const ts = [...playlist.value.tracks];
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
  if (!playlist.value) return;
  const first = await queue.playFromTracks(displayTracks.value, i);
  if (first) await player.play(first);
}

async function reorderTracks(fromIndex: number, toIndex: number): Promise<void> {
  if (!playlist.value || mutationBusy.value) return;
  const previousTracks = playlist.value.tracks;
  const nextTracks = moveItem(previousTracks, fromIndex, toIndex);
  playlist.value = { ...playlist.value, tracks: nextTracks };
  mutationBusy.value = true;
  try {
    await playlists.setTracks(
      playlist.value.id,
      nextTracks.map((track) => track.id)
    );
  } catch (err) {
    playlist.value = { ...playlist.value, tracks: previousTracks };
    reportError(err);
  } finally {
    mutationBusy.value = false;
  }
}

async function removeTracks(tracksToRemove: Track[]): Promise<void> {
  const current = playlist.value;
  if (!current || mutationBusy.value || tracksToRemove.length === 0) return;

  const previousTracks = current.tracks;
  const nextTracks = removePlaylistOccurrences(previousTracks, tracksToRemove);
  if (nextTracks.length === previousTracks.length) return;

  const removedCount = previousTracks.length - nextTracks.length;
  const previousSelection = [...selectedTracks.value];
  const previousAnchor = selectionAnchor.value;
  playlist.value = { ...current, tracks: nextTracks };
  selectedTracks.value = [];
  selectionAnchor.value = null;
  mutationBusy.value = true;
  try {
    await playlists.setTracks(
      current.id,
      nextTracks.map((track) => track.id)
    );
    $q.notify({
      type: "positive",
      message: `${removedCount} ${removedCount === 1 ? "track" : "tracks"} removed from “${current.name}”`,
      timeout: 2400,
    });
  } catch (err) {
    playlist.value = { ...current, tracks: previousTracks };
    selectedTracks.value = previousSelection;
    selectionAnchor.value = previousAnchor;
    reportError(err);
  } finally {
    mutationBusy.value = false;
  }
}

async function renamePlaylist(): Promise<void> {
  if (!playlist.value) return;
  const name = window.prompt("Playlist name:", playlist.value.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    await playlists.rename(playlist.value.id, trimmed);
    playlist.value = { ...playlist.value, name: trimmed };
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function saveStorage(): Promise<void> {
  if (!playlist.value) return;
  try {
    const sourceId =
      selectedStorageSource.value === "local" ? null : selectedStorageSource.value;
    await playlists.setStorage(playlist.value.id, sourceId);
    playlist.value = await playlists.get(playlist.value.id);
    selectedStorageSource.value = playlist.value.storage.sourceId ?? "local";
    storageDialogOpen.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function deletePlaylist(): Promise<void> {
  if (!playlist.value) return;
  if (!window.confirm(`Delete "${playlist.value.name}"?`)) return;
  try {
    await playlists.remove(playlist.value.id);
    await router.push({ name: "playlists" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function cycleSort(key: TrackSortKey): void {
  if (sortKey.value !== key) {
    sortKey.value = key;
    sortDirection.value = "asc";
  } else if (sortDirection.value === "asc") {
    sortDirection.value = "desc";
  } else {
    sortKey.value = null;
    sortDirection.value = "asc";
  }
}

function clearSort(): void {
  sortKey.value = null;
  sortDirection.value = "asc";
}

function selectTrack(
  track: Track,
  _index: number,
  modifiers: SelectionModifiers
): void {
  const next = updateOccurrenceSelection(
    displayTracks.value,
    selectedTracks.value,
    selectionAnchor.value,
    track,
    modifiers
  );
  selectedTracks.value = next.selected;
  selectionAnchor.value = next.anchor;
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

function reportError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  error.value = message;
  $q.notify({ type: "negative", message });
}

function sourceName(sourceId: number): string {
  return sources.sources.find((source) => source.id === sourceId)?.name ?? `Source ${sourceId}`;
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}
</script>

<style scoped>
.playlist-page {
  padding-bottom: 32px;
}

.playlist-header {
  display: flex;
  gap: 28px;
  padding: 32px;
  align-items: flex-end;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.playlist-art-large {
  width: 200px;
  height: 200px;
  border-radius: 10px;
  background: linear-gradient(135deg, #3a2e4a, #1a1c22);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}

.playlist-header-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.playlist-header-eyebrow {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #ff6b87;
}

.playlist-header-title {
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.playlist-header-meta {
  font-size: 13px;
  color: var(--am-text-secondary);
  margin: 4px 0 16px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.playlist-storage {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--am-text-muted);
}

.playlist-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

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
