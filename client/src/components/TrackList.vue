<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div
    class="track-list"
    :class="{ reorderable, reordering: dragState !== null }"
  >
    <div class="track-list-scroller">
      <div class="track-list-table" :style="{ minWidth: tableMinWidth }">
        <div class="track-list-header" :style="rowGridStyle">
          <div v-if="reorderable" class="th th-drag"></div>
          <div class="th th-num">#</div>
          <button
            class="th th-button th-title"
            type="button"
            :disabled="!sortable"
            @click="requestSort('title')"
          >
            <span>Title</span>
            <q-icon v-if="sortable" :name="sortIcon('title')" size="14px" />
          </button>
          <button
            v-for="column in visibleColumns"
            :key="column"
            class="th th-button"
            :class="`th-${column}`"
            type="button"
            :disabled="!sortable"
            @click="requestSort(column)"
          >
            <span>{{ columnLabel(column) }}</span>
            <q-icon v-if="sortable" :name="sortIcon(column)" size="14px" />
          </button>
        </div>

        <div
          v-for="(t, i) in tracks"
          :key="`${t.sourceId}:${t.sourceTrackId}:${i}`"
          class="track-row"
          :class="{
            playing: playingTrackId === t.id,
            selected: isSelected(t),
            'drag-source': isDragSource(i),
            'drop-target': isDropTarget(i),
          }"
          :style="rowGridStyle"
          :data-track-index="i"
          role="button"
          tabindex="0"
          :aria-selected="selectable ? isSelected(t) : undefined"
          @click="onRowClick($event, t, i)"
          @dblclick="onRowDoubleClick(t, i)"
          @contextmenu.prevent="onRowContextMenu($event, t, i)"
          @pointerdown="onRowPointerDown($event, t, i)"
          @pointermove="onRowPointerMove"
          @pointerup="onRowPointerEnd"
          @pointercancel="onRowPointerEnd"
          @keydown.enter="onRowEnter(t, i)"
          @keydown="onRowMenuKeyDown($event, t, i)"
          data-playback-shortcut-surface
        >
          <div v-if="reorderable" class="td td-drag">
            <button
              class="drag-handle"
              type="button"
              :aria-label="`Move ${t.title || 'track'}`"
              @click.stop
              @keydown.stop
              @pointerdown="startReorder($event, i)"
              @pointermove="moveReorder"
              @pointerup="finishReorder"
              @pointercancel="cancelReorder"
            >
              <q-icon name="drag_indicator" size="18px" />
              <q-tooltip>Reorder</q-tooltip>
            </button>
          </div>
          <div class="td td-num">
            <span v-if="playingTrackId !== t.id" class="track-num">{{ i + 1 }}</span>
            <q-icon v-else name="graphic_eq" size="16px" class="track-playing-icon" />
          </div>
          <div class="td td-title">
            <button
              class="track-cover-button"
              type="button"
              :aria-label="`Play ${t.title || 'track'}`"
              @click.stop="onCoverClick($event, t, i)"
            >
              <AlbumCover :hash="t.artHash" :alt="t.title" :size="36" />
            </button>
            <div class="track-title-text">
              <div class="track-title">{{ t.title || "Untitled" }}</div>
              <div class="track-artist">{{ t.artist }}</div>
            </div>
            <q-btn
              flat
              round
              dense
              icon="more_vert"
              class="track-menu-button"
              :aria-label="`More actions for ${t.title || 'track'}`"
              @click.stop="openRowMenuFromButton($event, t, i)"
              @pointerdown.stop
              @keydown.stop
            />
          </div>
          <div
            v-for="column in visibleColumns"
            :key="column"
            class="td td-text"
            :class="[`td-${column}`, { mono: isMonoColumn(column) }]"
          >
            <button
              v-if="linkableColumn(t, column)"
              class="metadata-link"
              type="button"
              @click.stop="onMetadataLink(column, t)"
            >
              {{ columnValue(t, column) }}
            </button>
            <template v-else>{{ columnValue(t, column) }}</template>
          </div>
        </div>
      </div>
    </div>

    <q-menu
      ref="rowMenu"
      touch-position
      no-parent-event
      content-class="track-context-menu"
      @before-show="ensureSources"
    >
      <q-list dense class="track-context-menu-list">
        <q-item-label header class="ellipsis">{{ rowMenuTitle }}</q-item-label>
        <q-item
          v-if="rowMenuTrack"
          clickable
          v-close-popup
          @click="playFromMenu"
        >
          <q-item-section avatar><q-icon name="play_arrow" /></q-item-section>
          <q-item-section>Play</q-item-section>
        </q-item>
        <q-item clickable v-close-popup :disable="actionBusy" @click="addToQueue">
          <q-item-section avatar><q-icon name="queue_music" /></q-item-section>
          <q-item-section>{{ rowMenuQueueLabel }}</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="playlistPickerOpen = true">
          <q-item-section avatar><q-icon name="playlist_add" /></q-item-section>
          <q-item-section>{{ rowMenuPlaylistLabel }}…</q-item-section>
        </q-item>
        <q-item
          v-if="removable"
          clickable
          v-close-popup
          :disable="removeBusy"
          @click="requestRemove"
        >
          <q-item-section avatar><q-icon name="playlist_remove" color="red-5" /></q-item-section>
          <q-item-section class="text-red-5">{{ rowMenuRemoveLabel }}</q-item-section>
        </q-item>
        <q-separator />
        <q-item
          v-if="linkMetadata && rowMenuTrack?.artist"
          clickable
          v-close-popup
          @click="viewArtist(rowMenuTrack.artist)"
        >
          <q-item-section avatar><q-icon name="person" /></q-item-section>
          <q-item-section>View Artist</q-item-section>
        </q-item>
        <q-item
          v-if="linkMetadata && rowMenuTrack?.album"
          clickable
          v-close-popup
          @click="viewAlbum(rowMenuTrack)"
        >
          <q-item-section avatar><q-icon name="album" /></q-item-section>
          <q-item-section>View Album</q-item-section>
        </q-item>
        <q-item
          v-if="rowMenuTrack"
          clickable
          v-close-popup
          @click="showTrackInfo(rowMenuTrack)"
        >
          <q-item-section avatar><q-icon name="info" /></q-item-section>
          <q-item-section>Info</q-item-section>
        </q-item>
      </q-list>
    </q-menu>

    <q-dialog v-model="trackInfoOpen">
      <q-card class="track-info-card">
        <q-card-section class="row items-start no-wrap">
          <AlbumCover
            v-if="infoTrack"
            :hash="infoTrack.artHash"
            :alt="infoTrack.title"
            :size="72"
          />
          <div class="track-info-title">
            <div class="text-h6">{{ infoTrack?.title || "Untitled" }}</div>
            <div class="text-caption text-grey-5">{{ infoTrack?.artist || "Unknown artist" }}</div>
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <div class="info-grid">
            <template v-for="row in infoRows" :key="row.label">
              <div class="info-label">{{ row.label }}</div>
              <div class="info-value">{{ row.value }}</div>
            </template>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <PlaylistPickerDialog
      v-model="playlistPickerOpen"
      :title="rowMenuPlaylistLabel"
      :excluded-playlist-id="currentPlaylistId ?? null"
      :busy="actionBusy"
      @selected="addToPlaylist"
    />

    <div v-if="tracks.length === 0" class="track-list-empty">
      {{ emptyLabel ?? "No tracks." }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useQuasar } from "quasar";
import type { Playlist, Track } from "@jmmp/shared";
import AlbumCover from "./AlbumCover.vue";
import PlaylistPickerDialog from "./PlaylistPickerDialog.vue";
import { usePlaylistsStore } from "src/stores/playlists";
import { useQueueStore } from "src/stores/queue";
import { useSourcesStore } from "src/stores/sources";
import type { SelectionModifiers } from "src/tracks/selection";
import {
  DEFAULT_PLAYLIST_COLUMNS,
  type SortDirection,
  type TrackColumnKey,
  type TrackSortKey,
} from "src/tracks/sort";
import {
  movedPastLongPressTolerance,
  shouldArmTrackRowLongPress,
  shouldOpenTrackRowContextMenu,
  TRACK_ROW_LONG_PRESS_MS,
} from "src/tracks/row-interaction";

const props = defineProps<{
  tracks: Track[];
  playingTrackId?: number | null;
  emptyLabel?: string;
  reorderable?: boolean;
  selectable?: boolean;
  selectedTrackIds?: number[];
  selectedTracks?: Track[];
  selectionScopeTracks?: Track[];
  columns?: TrackColumnKey[];
  sortable?: boolean;
  sortKey?: TrackSortKey | null;
  sortDirection?: SortDirection;
  linkMetadata?: boolean;
  removable?: boolean;
  removeBusy?: boolean;
  currentPlaylistId?: number;
}>();
const emit = defineEmits<{
  play: [track: Track, index: number];
  reorder: [fromIndex: number, toIndex: number];
  select: [track: Track, index: number, modifiers: SelectionModifiers];
  sort: [key: TrackSortKey];
  viewArtist: [artist: string, track: Track];
  viewAlbum: [track: Track];
  remove: [tracks: Track[]];
}>();

const $q = useQuasar();
const playlists = usePlaylistsStore();
const queue = useQueueStore();
const sources = useSourcesStore();
const rowMenu = ref<{ show: (evt?: Event) => void } | null>(null);
const rowMenuTrack = ref<Track | null>(null);
const rowMenuTrackIndex = ref(-1);
const rowMenuTracks = ref<Track[]>([]);
const actionBusy = ref(false);
const playlistPickerOpen = ref(false);
const trackInfoOpen = ref(false);
const infoTrack = ref<Track | null>(null);
const longPressState = ref<{
  pointerId: number;
  track: Track;
  index: number;
  startX: number;
  startY: number;
  timeoutId: number;
  opened: boolean;
} | null>(null);
const suppressNextClickTrackId = ref<number | null>(null);
const suppressContextMenuUntil = ref(0);
const dragState = ref<{
  pointerId: number;
  fromIndex: number;
  overIndex: number;
  handle: HTMLElement;
} | null>(null);
const selectedIdSet = computed(() => new Set(props.selectedTrackIds ?? []));
const selectedOccurrenceSet = computed(() => new Set(props.selectedTracks ?? []));
const visibleColumns = computed(() => props.columns ?? DEFAULT_PLAYLIST_COLUMNS);
const rowMenuTrackIds = computed(() => rowMenuTracks.value.map((track) => track.id));
const rowMenuTitle = computed(() =>
  rowMenuTrackIds.value.length > 1
    ? `${rowMenuTrackIds.value.length} selected tracks`
    : rowMenuTrack.value?.title || "Track"
);
const rowMenuPlaylistLabel = computed(() =>
  playlistHeader(rowMenuTrackIds.value.length)
);
const rowMenuQueueLabel = computed(() =>
  rowMenuTrackIds.value.length > 1
    ? `Add ${rowMenuTrackIds.value.length} tracks to queue`
    : "Add to queue"
);
const rowMenuRemoveLabel = computed(() =>
  rowMenuTrackIds.value.length > 1
    ? `Remove ${rowMenuTrackIds.value.length} tracks from playlist`
    : "Remove from playlist"
);
const gridTemplateColumns = computed(() => {
  const cols = [
    ...(props.reorderable ? ["32px"] : []),
    "32px",
    "minmax(220px, 1.5fr)",
    ...visibleColumns.value.map(columnWidth),
  ];
  return cols.join(" ");
});
const rowGridStyle = computed(() => ({
  gridTemplateColumns: gridTemplateColumns.value,
}));
const tableMinWidth = computed(() => {
  const base = props.reorderable ? 312 : 280;
  const extra = visibleColumns.value.reduce((sum, column) => sum + minColumnWidth(column), 0);
  return `${base + extra}px`;
});
const infoRows = computed(() => {
  const track = infoTrack.value;
  if (!track) return [];
  return [
    infoRow("Source", sourceName(track.sourceId)),
    infoRow("Source track ID", track.sourceTrackId),
    infoRow("Album", track.album),
    infoRow("Album artist", track.albumArtist),
    infoRow("Year", track.year),
    infoRow("Track", track.trackNo),
    infoRow("Disc", track.discNo),
    infoRow("Duration", formatDuration(track.durationMs)),
    infoRow("Codec", track.codec.toUpperCase()),
    infoRow("Sample rate", track.sampleRate ? `${track.sampleRate} Hz` : undefined),
    infoRow("Bit depth", track.bitDepth ? `${track.bitDepth}-bit` : undefined),
    infoRow("Channels", track.channels),
    infoRow("File size", track.fileSize ? formatBytes(track.fileSize) : undefined),
    infoRow("ReplayGain track", dbValue(track.rgTrackDb)),
    infoRow("ReplayGain album", dbValue(track.rgAlbumDb)),
    infoRow("Art hash", track.artHash),
  ].filter((row): row is { label: string; value: string } => row !== null);
});

onMounted(() => {
  void ensureSourcesForColumns();
});

watch(
  () => visibleColumns.value.join(","),
  () => {
    void ensureSourcesForColumns();
  }
);

async function ensureSources(): Promise<void> {
  if (!sources.loaded) await sources.load().catch(() => {});
}

async function ensureSourcesForColumns(): Promise<void> {
  if (visibleColumns.value.includes("source")) await ensureSources();
}

async function addToPlaylist(playlist: Playlist): Promise<void> {
  const trackIds = rowMenuTrackIds.value;
  if (trackIds.length === 0) return;
  actionBusy.value = true;
  try {
    await playlists.append(playlist.id, trackIds);
    playlistPickerOpen.value = false;
    notifySuccess(`${trackCountLabel(trackIds.length)} added to “${playlist.name}”`);
  } catch (err) {
    notifyError(err);
  } finally {
    actionBusy.value = false;
  }
}

async function addToQueue(): Promise<void> {
  const trackIds = rowMenuTrackIds.value;
  if (trackIds.length === 0) return;
  actionBusy.value = true;
  try {
    await queue.append(trackIds);
    notifySuccess(`${trackCountLabel(trackIds.length)} added to the queue`);
  } catch (err) {
    notifyError(err);
  } finally {
    actionBusy.value = false;
  }
}

function playFromMenu(): void {
  const track = rowMenuTrack.value;
  if (!track || rowMenuTrackIndex.value < 0) return;
  emit("play", track, rowMenuTrackIndex.value);
}

function requestRemove(): void {
  if (rowMenuTracks.value.length === 0) return;
  emit("remove", [...rowMenuTracks.value]);
}

function onCoverClick(event: MouseEvent, track: Track, index: number): void {
  if (consumeSuppressedClick(track.id)) {
    event.preventDefault();
    return;
  }
  emit("play", track, index);
}

function onRowClick(event: MouseEvent, track: Track, index: number): void {
  if (consumeSuppressedClick(track.id)) {
    event.preventDefault();
    return;
  }
  if (event.button !== 0) return;
  if (!props.selectable) {
    emit("play", track, index);
    return;
  }
  emit("select", track, index, modifiersFromEvent(event));
}

function onRowDoubleClick(track: Track, index: number): void {
  if (props.selectable) emit("play", track, index);
}

function onRowEnter(track: Track, index: number): void {
  emit("play", track, index);
}

function onRowContextMenu(event: MouseEvent, track: Track, index: number): void {
  if (Date.now() < suppressContextMenuUntil.value) return;
  if (!shouldOpenTrackRowContextMenu(event.button, event.ctrlKey)) return;
  cancelLongPress();
  openRowMenu(event, track, index);
}

function openRowMenu(event: Event, track: Track, index: number): void {
  setRowMenuContext(track, index);
  rowMenu.value?.show(event);
}

function openRowMenuFromButton(event: Event, track: Track, index: number): void {
  cancelLongPress();
  openRowMenu(event, track, index);
}

function setRowMenuContext(track: Track, index: number): void {
  const wasSelected = isSelected(track);
  if (props.selectable && !wasSelected) emit("select", track, index, {});
  rowMenuTrack.value = track;
  rowMenuTrackIndex.value = index;
  rowMenuTracks.value =
    props.selectable && wasSelected
      ? (props.selectionScopeTracks ?? props.tracks).filter((candidate) =>
          isSelected(candidate)
        )
      : [track];
}

function onRowMenuKeyDown(event: KeyboardEvent, track: Track, index: number): void {
  const isContextMenuKey = event.key === "ContextMenu";
  const isShiftF10 = event.shiftKey && event.key === "F10";
  if (!isContextMenuKey && !isShiftF10) return;

  event.preventDefault();
  event.stopPropagation();
  const row = event.currentTarget;
  const rect = row instanceof HTMLElement ? row.getBoundingClientRect() : null;
  openRowMenu(
    new MouseEvent("contextmenu", {
      bubbles: true,
      button: 2,
      clientX: rect ? rect.left + Math.min(36, rect.width / 2) : 0,
      clientY: rect ? rect.top + Math.min(28, rect.height / 2) : 0,
    }),
    track,
    index
  );
}

function onRowPointerDown(event: PointerEvent, track: Track, index: number): void {
  if (!shouldArmTrackRowLongPress(event.pointerType, event.button)) return;
  cancelLongPress();
  const timeoutId = window.setTimeout(() => {
    const state = longPressState.value;
    if (!state || state.pointerId !== event.pointerId) return;
    state.opened = true;
    suppressNextClickTrackId.value = track.id;
    suppressContextMenuUntil.value = Date.now() + 1000;
    openRowMenu(event, track, index);
  }, TRACK_ROW_LONG_PRESS_MS);
  longPressState.value = {
    pointerId: event.pointerId,
    track,
    index,
    startX: event.clientX,
    startY: event.clientY,
    timeoutId,
    opened: false,
  };
}

function onRowPointerMove(event: PointerEvent): void {
  const state = longPressState.value;
  if (!state || state.pointerId !== event.pointerId || state.opened) return;
  if (
    movedPastLongPressTolerance(
      state.startX,
      state.startY,
      event.clientX,
      event.clientY
    )
  ) {
    cancelLongPress();
  }
}

function onRowPointerEnd(event: PointerEvent): void {
  const opened = longPressState.value?.opened === true;
  cancelLongPress(event.pointerId);
  if (opened) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function cancelLongPress(pointerId?: number): void {
  const state = longPressState.value;
  if (!state || (pointerId !== undefined && state.pointerId !== pointerId)) return;
  window.clearTimeout(state.timeoutId);
  longPressState.value = null;
}

onBeforeUnmount(() => cancelLongPress());

function consumeSuppressedClick(trackId: number): boolean {
  if (suppressNextClickTrackId.value !== trackId) return false;
  suppressNextClickTrackId.value = null;
  return true;
}

function showTrackInfo(track: Track): void {
  infoTrack.value = track;
  trackInfoOpen.value = true;
}

function linkableColumn(track: Track, column: TrackColumnKey): boolean {
  return Boolean(
    props.linkMetadata &&
      ((column === "artist" && track.artist) || (column === "album" && track.album))
  );
}

function onMetadataLink(column: TrackColumnKey, track: Track): void {
  if (column === "artist") viewArtist(track.artist, track);
  if (column === "album") viewAlbum(track);
}

function viewArtist(artist: string, track = rowMenuTrack.value): void {
  if (!artist || !track) return;
  emit("viewArtist", artist, track);
}

function viewAlbum(track: Track | null): void {
  if (!track?.album) return;
  emit("viewAlbum", track);
}

function modifiersFromEvent(event: MouseEvent | KeyboardEvent): SelectionModifiers {
  return {
    range: event.shiftKey,
    additive: event.metaKey || event.ctrlKey,
  };
}

function isSelected(track: Track): boolean {
  return props.selectedTracks
    ? selectedOccurrenceSet.value.has(track)
    : selectedIdSet.value.has(track.id);
}

function playlistHeader(count: number): string {
  return count > 1 ? `Add ${count} tracks to playlist` : "Add to playlist";
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

function requestSort(key: TrackSortKey): void {
  if (!props.sortable) return;
  emit("sort", key);
}

function sortIcon(key: TrackSortKey): string {
  if (props.sortKey !== key) return "unfold_more";
  return props.sortDirection === "desc" ? "arrow_downward" : "arrow_upward";
}

function startReorder(event: PointerEvent, index: number): void {
  if (!props.reorderable || props.tracks.length < 2) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  dragState.value = {
    pointerId: event.pointerId,
    fromIndex: index,
    overIndex: index,
    handle,
  };
  event.preventDefault();
  event.stopPropagation();
}

function moveReorder(event: PointerEvent): void {
  const state = dragState.value;
  if (!state || state.pointerId !== event.pointerId) return;
  const overIndex = trackIndexAt(event.clientX, event.clientY);
  maybeAutoScroll(event.clientY);
  if (overIndex !== null && overIndex !== state.overIndex) {
    dragState.value = { ...state, overIndex };
  }
  event.preventDefault();
  event.stopPropagation();
}

function finishReorder(event: PointerEvent): void {
  const state = dragState.value;
  if (!state || state.pointerId !== event.pointerId) return;
  if (state.handle.hasPointerCapture(event.pointerId)) {
    state.handle.releasePointerCapture(event.pointerId);
  }
  dragState.value = null;
  if (state.overIndex !== state.fromIndex) {
    emit("reorder", state.fromIndex, state.overIndex);
  }
  event.preventDefault();
  event.stopPropagation();
}

function cancelReorder(event: PointerEvent): void {
  const state = dragState.value;
  if (!state || state.pointerId !== event.pointerId) return;
  if (state.handle.hasPointerCapture(event.pointerId)) {
    state.handle.releasePointerCapture(event.pointerId);
  }
  dragState.value = null;
  event.preventDefault();
  event.stopPropagation();
}

function trackIndexAt(x: number, y: number): number | null {
  const row = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>(".track-row[data-track-index]");
  const raw = row?.dataset.trackIndex;
  if (raw === undefined) return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function maybeAutoScroll(y: number): void {
  const edge = 72;
  if (y < edge) {
    window.scrollBy({ top: -18 });
  } else if (y > window.innerHeight - edge) {
    window.scrollBy({ top: 18 });
  }
}

function isDragSource(index: number): boolean {
  return dragState.value?.fromIndex === index;
}

function isDropTarget(index: number): boolean {
  const state = dragState.value;
  return Boolean(state && state.overIndex === index && state.fromIndex !== index);
}

function columnLabel(column: TrackColumnKey): string {
  if (column === "duration") return "Time";
  if (column === "quality") return "Quality";
  return column[0]!.toUpperCase() + column.slice(1);
}

function columnWidth(column: TrackColumnKey): string {
  if (column === "duration") return "68px";
  if (column === "codec") return "78px";
  if (column === "quality") return "112px";
  if (column === "source") return "minmax(110px, 0.7fr)";
  return "minmax(130px, 1fr)";
}

function minColumnWidth(column: TrackColumnKey): number {
  if (column === "duration") return 68;
  if (column === "codec") return 78;
  if (column === "quality") return 112;
  if (column === "source") return 110;
  return 130;
}

function columnValue(track: Track, column: TrackColumnKey): string {
  if (column === "artist") return track.artist || "";
  if (column === "album") return track.album || "";
  if (column === "source") return sourceName(track.sourceId);
  if (column === "duration") return formatDuration(track.durationMs);
  if (column === "codec") return track.codec.toUpperCase();
  return qualityLabel(track);
}

function isMonoColumn(column: TrackColumnKey): boolean {
  return ["duration", "codec", "quality"].includes(column);
}

function sourceName(sourceId: number): string {
  return sources.sources.find((source) => source.id === sourceId)?.name ?? `Source ${sourceId}`;
}

function qualityLabel(track: Track): string {
  const sampleRate = track.sampleRate
    ? `${Math.round(track.sampleRate / 100) / 10} kHz`
    : "";
  const bitDepth = track.bitDepth ? `${track.bitDepth}-bit` : "";
  return [sampleRate, bitDepth].filter(Boolean).join(" / ") || "-";
}

function infoRow(
  label: string,
  value: string | number | undefined | null
): { label: string; value: string } | null {
  if (value === undefined || value === null || value === "") return null;
  return { label, value: String(value) };
}

function dbValue(value: number | undefined): string | undefined {
  return typeof value === "number" ? `${value.toFixed(2)} dB` : undefined;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms: number): string {
  if (!ms) return "-";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}
</script>

<style scoped>
.track-list {
  padding: 0 12px 32px;
}

@media (min-width: 600px) {
  .track-list {
    padding: 0 32px 32px;
  }
}

.track-list-scroller {
  overflow-x: auto;
}

.track-list-table {
  width: 100%;
}

.track-list-header,
.track-row {
  display: grid;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
}

@media (min-width: 600px) {
  .track-list-header,
  .track-row {
    gap: 16px;
    padding: 8px 12px;
  }
}

.track-list-header {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--am-text-muted);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 4px;
}

.th-button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  display: inline-flex;
  gap: 4px;
  align-items: center;
  text-align: left;
  text-transform: inherit;
  letter-spacing: inherit;
  font: inherit;
}

.th-button:disabled {
  cursor: default;
}

.th-button:not(:disabled) {
  cursor: pointer;
}

.th-button:not(:disabled):hover {
  color: var(--am-text-primary);
}

.th-num,
.td-num {
  text-align: center;
}

.track-row {
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  width: 100%;
  text-align: left;
  color: inherit;
}

.track-row:hover {
  background: var(--am-row-hover);
}

.track-row.selected {
  background: rgba(255, 107, 135, 0.12);
  outline: 1px solid rgba(255, 107, 135, 0.34);
}

.track-row.playing {
  color: #ff6b87;
}

.track-list.reordering .track-row {
  user-select: none;
}

.track-row.drag-source {
  opacity: 0.58;
}

.track-row.drop-target {
  background: rgba(255, 107, 135, 0.14);
  outline: 1px solid rgba(255, 107, 135, 0.6);
}

.th-drag,
.td-drag {
  display: flex;
  justify-content: center;
}

.drag-handle {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--am-text-muted);
  cursor: grab;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  touch-action: none;
}

.drag-handle:hover,
.drag-handle:focus-visible {
  background: var(--am-row-hover);
  color: var(--am-text-primary);
  outline: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.track-num {
  font-size: 12px;
  color: var(--am-text-muted);
}

.track-playing-icon {
  color: #ff6b87;
}

.td-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.track-cover-button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  flex: 0 0 auto;
}

.track-cover-button:focus-visible {
  outline: 2px solid rgba(255, 107, 135, 0.7);
  outline-offset: 2px;
}

.track-title-text {
  flex: 1;
  min-width: 0;
}

.track-menu-button {
  color: var(--am-text-muted);
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease;
}

.track-row:hover .track-menu-button,
.track-row:focus-within .track-menu-button,
.track-menu-button:focus-visible {
  opacity: 1;
}

.track-menu-button:hover {
  color: var(--am-text-primary);
}

@media (hover: none), (max-width: 599px) {
  .track-menu-button {
    opacity: 1;
  }
}

.track-title {
  font-size: 13px;
  font-weight: 500;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-artist {
  font-size: 11px;
  color: var(--am-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.td-text {
  font-size: 12px;
  color: var(--am-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.metadata-link {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metadata-link:hover,
.metadata-link:focus-visible {
  color: var(--am-text-primary);
  text-decoration: underline;
  outline: none;
}

.td-duration,
.td-codec,
.td-quality {
  color: var(--am-text-muted);
  text-align: right;
}

.track-list-empty {
  padding: 32px;
  text-align: center;
  color: var(--am-text-muted);
}

.track-info-card {
  width: min(560px, calc(100vw - 32px));
  background: #1d2027;
  color: var(--am-text-primary);
}

:global(.track-context-menu) {
  width: min(310px, calc(100vw - 24px));
  max-width: min(310px, calc(100vw - 24px));
}

.track-context-menu-list {
  min-width: 260px;
}

.track-info-title {
  min-width: 0;
  margin-left: 16px;
}

.info-grid {
  display: grid;
  grid-template-columns: minmax(110px, 0.35fr) minmax(0, 1fr);
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
