<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <Teleport to="body">
    <Transition name="np-fade">
      <div v-if="open" class="np-screen" @click.self="close">
        <div class="np-shell" :class="{ mobile: $q.screen.lt.md }">
          <button class="np-close" aria-label="Minimize Now Playing" @click="close">
            <q-icon name="expand_more" size="28px" />
            <q-tooltip>Minimize</q-tooltip>
          </button>

          <div class="row q-col-gutter-lg np-stage no-wrap-md">
            <div class="col-12 col-md-4 np-art-col">
              <div class="np-art">
                <img v-if="artUrl" :src="artUrl" alt="" />
                <q-icon v-else name="music_note" size="120px" class="np-art-placeholder" />
              </div>
            </div>

            <div class="col-12 col-md-5 np-info-col">
              <div class="np-title">{{ player.current?.title || "—" }}</div>
              <div class="np-artist">{{ player.current?.artist || "" }}</div>
              <div class="np-album">{{ player.current?.album || "" }}</div>
              <PlaybackDiagnostics />

              <div class="np-scrubber">
                <span class="time-label mono">{{ formatTime(player.position) }}</span>
                <q-slider
                  :model-value="player.position"
                  :min="0"
                  :max="player.duration || 0"
                  :step="0.1"
                  dense
                  color="white"
                  track-color="grey-8"
                  class="np-scrubber-slider"
                  @change="seek"
                />
                <span class="time-label mono">{{ formatTime(player.duration) }}</span>
              </div>

              <div class="np-controls">
                <q-btn flat round dense size="md" icon="shuffle" />
                <q-btn flat round dense size="md" icon="skip_previous" @click="prev" />
                <q-btn unelevated round size="lg" class="np-play" :icon="player.state === 'playing' ? 'pause' : 'play_arrow'" @click="player.toggle" />
                <q-btn flat round dense size="md" icon="skip_next" @click="next" />
                <q-btn
                  flat
                  round
                  dense
                  size="md"
                  :icon="player.currentPinned ? 'offline_pin' : 'favorite_border'"
                  :color="player.currentPinned ? 'primary' : undefined"
                  :disable="!player.current || player.moqEnabled"
                  @click="togglePin"
                />
                <q-btn flat round dense size="md" icon="repeat" />
              </div>

              <div class="np-pitch-panel">
                <div class="np-panel-title">Pitch · Tempo · Speed</div>
                <PitchControl
                  v-model="hud.pitchSemi"
                  label="Pitch"
                  unit="st"
                  :min="-pitchMax"
                  :max="pitchMax"
                  :step="0.01"
                  @input="onPitchChange"
                />
                <PitchControl
                  v-model="hud.tempoPct"
                  label="Tempo"
                  unit="%"
                  :min="tempoMin"
                  :max="tempoMax"
                  :step="0.1"
                  @input="onPitchChange"
                />
                <PitchControl
                  v-model="hud.speedPct"
                  label="Speed"
                  unit="%"
                  :min="speedMin"
                  :max="speedMax"
                  :step="0.1"
                  @input="onPitchChange"
                />
                <q-btn flat dense size="sm" icon="restart_alt" label="Reset" class="np-reset" @click="resetPitch" />
              </div>
            </div>

            <div class="col-12 col-md-3 np-side gt-sm">
              <div class="np-side-header">Up Next</div>
              <q-scroll-area class="np-queue">
                <div
                  v-for="(entry, i) in queue.entries"
                  :key="entry.position"
                  class="np-queue-item"
                  :class="{ playing: queue.index === i }"
                  @click="onQueueClick(i)"
                >
                  <div class="np-queue-info">
                    <div class="np-queue-title">{{ entry.track.title || "Untitled" }}</div>
                    <div class="np-queue-artist">{{ entry.track.artist || "" }}</div>
                  </div>
                </div>
                <div v-if="queue.entries.length === 0" class="np-queue-empty text-grey-6">
                  No tracks in the queue.
                </div>
              </q-scroll-area>
            </div>
          </div>

          <!-- Mobile: queue as a collapsible drawer at the bottom -->
          <q-expansion-item
            v-if="$q.screen.lt.md"
            label="Up Next"
            icon="queue_music"
            class="np-mobile-queue"
            header-class="text-white"
            expand-icon-class="text-grey-5"
          >
            <q-list separator>
              <q-item
                v-for="(entry, i) in queue.entries"
                :key="entry.position"
                clickable
                :active="queue.index === i"
                @click="onQueueClick(i)"
              >
                <q-item-section>
                  <q-item-label>{{ entry.track.title || "Untitled" }}</q-item-label>
                  <q-item-label caption>{{ entry.track.artist || "" }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="queue.entries.length === 0">
                <q-item-section class="text-grey-6">No tracks in the queue.</q-item-section>
              </q-item>
            </q-list>
          </q-expansion-item>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import PlaybackDiagnostics from "./PlaybackDiagnostics.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePlayerStore } from "src/stores/player";
import { useQueueStore } from "src/stores/queue";
import { useSettingsStore } from "src/stores/settings";
import { artUrl as fetchArtUrl } from "src/storage/art-cache";
import {
  PITCH_RANGE_SEMI,
  SPEED_PCT_MAX,
  SPEED_PCT_MIN,
  TEMPO_PCT_MAX,
  TEMPO_PCT_MIN,
} from "@jmmp/shared";
import PitchControl from "./PitchControl.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [v: boolean] }>();

const player = usePlayerStore();
const queue = useQueueStore();
const settings = useSettingsStore();
const artUrl = ref<string | null>(null);
const hud = computed(() => settings.settings.pitchHud);
const pitchMax = PITCH_RANGE_SEMI;
const tempoMin = TEMPO_PCT_MIN;
const tempoMax = TEMPO_PCT_MAX;
const speedMin = SPEED_PCT_MIN;
const speedMax = SPEED_PCT_MAX;

watch(
  () => player.current?.artHash,
  async (hash) => {
    artUrl.value = hash ? await fetchArtUrl(hash) : null;
  },
  { immediate: true }
);

watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener("keydown", onKeydown);
    else document.removeEventListener("keydown", onKeydown);
  }
);

onMounted(async () => {
  if (!settings.loaded) await settings.load().catch(() => {});
  applyPitchToPlayer();
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});

function close(): void {
  emit("update:open", false);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

async function onQueueClick(i: number): Promise<void> {
  queue.index = i;
  const t = queue.entries[i]?.track;
  if (t) await player.play(t);
}

async function next(): Promise<void> {
  const t = queue.next();
  if (t) await player.play(t);
}

async function prev(): Promise<void> {
  const t = queue.prev();
  if (t) await player.play(t);
}

function seek(value: number | null): void {
  if (typeof value === "number") void player.seek(value);
}

function togglePin(): void {
  void player.togglePinCurrent();
}

function onPitchChange(): void {
  settings.patch({ pitchHud: { ...hud.value } });
  applyPitchToPlayer();
}

function resetPitch(): void {
  settings.patch({
    pitchHud: { ...hud.value, pitchSemi: 0, tempoPct: 0, speedPct: 0 },
  });
  applyPitchToPlayer();
}

function applyPitchToPlayer(): void {
  player.setParams({
    pitchSemi: hud.value.pitchSemi,
    tempoPct: hud.value.tempoPct,
    speedPct: hud.value.speedPct,
  });
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
</script>

<style scoped>
.np-screen {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background:
    radial-gradient(ellipse at top, rgba(80, 30, 60, 0.45), rgba(8, 10, 14, 0.92) 60%),
    rgba(8, 10, 14, 0.96);
  backdrop-filter: blur(32px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.np-shell {
  position: relative;
  width: min(1200px, 96vw);
  max-height: 92vh;
  border-radius: 18px;
  overflow-y: auto;
  background: rgba(20, 22, 28, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  padding: 36px 28px 24px;
}

.np-shell.mobile {
  padding: 56px 16px 16px;
  border-radius: 14px;
}

.np-close {
  position: absolute;
  top: 14px;
  left: 16px;
  background: transparent;
  border: none;
  color: var(--am-text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  z-index: 1;
}

.np-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: white;
}

.np-stage {
  align-items: center;
}

.np-art-col {
  display: flex;
  justify-content: center;
}

.np-art {
  width: 100%;
  max-width: 460px;
  aspect-ratio: 1;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(135deg, #2a2e36, #14161a);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}

.np-shell.mobile .np-art {
  max-width: 320px;
  margin: 0 auto;
}

.np-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.np-art-placeholder {
  color: rgba(255, 255, 255, 0.2);
}

.np-info-col {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}

.np-shell.mobile .np-info-col {
  text-align: center;
  align-items: center;
}

.np-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--am-text-primary);
}

.np-shell.mobile .np-title {
  font-size: 22px;
}

.np-artist {
  font-size: 18px;
  color: #ff6b87;
  margin-bottom: 2px;
}

.np-shell.mobile .np-artist {
  font-size: 15px;
}

.np-album {
  font-size: 14px;
  color: var(--am-text-secondary);
  margin-bottom: 16px;
}

.np-scrubber {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 16px;
  width: 100%;
}

.np-scrubber-slider {
  flex: 1;
}

.np-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
}

.np-pitch-panel {
  width: 100%;
  margin-top: 18px;
  padding: 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.np-panel-title {
  color: var(--am-text-secondary);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}

.np-reset {
  margin-top: 4px;
}

.np-play {
  background: white;
  color: black;
}

.np-play:hover {
  background: #f0f0f0;
}

.np-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  padding-left: 24px;
}

.np-side-header {
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--am-text-muted);
  margin-bottom: 8px;
}

.np-queue {
  flex: 1;
  min-height: 240px;
}

.np-queue-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.np-queue-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.np-queue-item.playing {
  background: rgba(255, 45, 85, 0.12);
}

.np-queue-title {
  font-size: 13px;
  color: var(--am-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-queue-artist {
  font-size: 11px;
  color: var(--am-text-secondary);
}

.np-queue-empty {
  padding: 16px;
  text-align: center;
}

.np-mobile-queue {
  margin-top: 24px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  overflow: hidden;
}

.time-label {
  font-size: 11px;
  color: var(--am-text-muted);
  min-width: 40px;
  text-align: center;
}

.np-fade-enter-active,
.np-fade-leave-active {
  transition: opacity 220ms ease;
}

.np-fade-enter-from,
.np-fade-leave-to {
  opacity: 0;
}
</style>
