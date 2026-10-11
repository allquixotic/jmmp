<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="transport-bar" :class="{ compact, 'has-tabbar': compact }">
    <!-- Compact pill (mobile): only art + title + play. Tap to expand. -->
    <div v-if="compact" class="pill" @click="$emit('open-now-playing')">
      <div class="now-art">
        <q-icon v-if="!artUrl" name="music_note" size="18px" />
        <img v-else :src="artUrl" alt="" />
      </div>
      <div class="now-text">
        <div class="now-title">{{ player.current?.title || "Nothing playing" }}</div>
        <div class="now-artist">{{ player.current?.artist || "" }}</div>
      </div>
      <q-btn
        flat
        round
        dense
        size="md"
        :icon="player.state === 'playing' ? 'pause' : 'play_arrow'"
        class="pill-play"
        @click.stop="player.toggle"
      />
      <q-btn flat round dense size="sm" icon="skip_next" @click.stop="next" />
    </div>

    <!-- Full transport (tablet+) -->
    <div v-else class="transport-shell">
      <!-- Now-playing zone -->
      <div class="zone-now" @click="$emit('open-now-playing')">
        <div class="now-art">
          <q-icon v-if="!artUrl" name="music_note" size="20px" />
          <img v-else :src="artUrl" alt="" />
        </div>
        <div class="now-text">
          <div class="now-title">
            {{ player.current?.title || "—" }}
          </div>
          <div class="now-artist">
            {{ player.current?.artist || (player.state === "idle" ? "Nothing playing" : "") }}
          </div>
        </div>
        <q-btn flat round dense size="sm" icon="open_in_full" class="now-expand">
          <q-tooltip>Open Now Playing</q-tooltip>
        </q-btn>
      </div>

      <!-- Transport zone -->
      <div class="zone-controls">
        <div class="transport-buttons">
          <q-btn flat round dense size="sm" icon="shuffle" :color="shuffle ? 'primary' : undefined" @click="shuffle = !shuffle" />
          <q-btn flat round dense icon="skip_previous" size="md" @click="prev" />
          <q-btn unelevated round size="md" class="play-btn" :icon="player.state === 'playing' ? 'pause' : 'play_arrow'" @click="player.toggle" />
          <q-btn flat round dense icon="skip_next" size="md" @click="next" />
          <q-btn flat round dense size="sm" icon="repeat" :color="repeat !== 'off' ? 'primary' : undefined" @click="cycleRepeat" />
        </div>
        <div class="scrubber">
          <span class="time-label mono">{{ formatTime(player.position) }}</span>
          <q-slider
            :model-value="player.position"
            :min="0"
            :max="player.duration || 0"
            :step="0.1"
            dense
            color="white"
            track-color="grey-8"
            class="scrubber-slider"
            @change="seek"
          />
          <span class="time-label mono">{{ formatTime(player.duration) }}</span>
        </div>
      </div>

      <!-- Secondary -->
      <div class="zone-extras">
        <q-btn flat round dense size="sm" icon="tune" @click="$emit('open-now-playing')">
          <q-tooltip>Pitch controls</q-tooltip>
        </q-btn>
        <q-btn
          flat
          round
          dense
          size="sm"
          :icon="player.currentPinned ? 'offline_pin' : 'favorite_border'"
          :color="player.currentPinned ? 'primary' : undefined"
          :disable="!player.current || player.moqEnabled"
          @click="togglePin"
        >
          <q-tooltip>{{ player.currentPinned ? "Unpin offline" : "Pin offline" }}</q-tooltip>
        </q-btn>
        <q-btn flat round dense size="sm" :icon="volumeIcon" @click="toggleMute" />
        <q-slider
          :model-value="player.volume"
          :min="0"
          :max="1"
          :step="0.01"
          dense
          color="white"
          track-color="grey-8"
          class="volume-slider"
          @update:model-value="setVolume"
        />
        <q-btn
          flat
          round
          dense
          size="sm"
          icon="queue_music"
          @click="$emit('open-now-playing')"
        >
          <q-tooltip>Up next</q-tooltip>
        </q-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { usePlayerStore } from "src/stores/player";
import { useQueueStore } from "src/stores/queue";
import { artUrl as fetchArtUrl } from "src/storage/art-cache";

defineProps<{ compact?: boolean }>();
defineEmits<{ "open-now-playing": [] }>();

const player = usePlayerStore();
const queue = useQueueStore();
const shuffle = ref(false);
const repeat = ref<"off" | "one" | "all">("off");
const previousVolume = ref(1);
const artUrl = ref<string | null>(null);

onMounted(() => {
  player.ensure();
});

watch(
  () => player.current?.artHash,
  async (hash) => {
    if (!hash) {
      artUrl.value = null;
      return;
    }
    artUrl.value = await fetchArtUrl(hash);
  },
  { immediate: true }
);

const volumeIcon = computed(() => {
  if (player.volume === 0) return "volume_off";
  if (player.volume < 0.5) return "volume_down";
  return "volume_up";
});

function toggleMute(): void {
  if (player.volume > 0) {
    previousVolume.value = player.volume;
    player.setVolume(0);
  } else {
    player.setVolume(previousVolume.value || 1);
  }
}

function setVolume(value: number | null): void {
  player.setVolume(typeof value === "number" ? value : player.volume);
}

function seek(value: number | null): void {
  if (typeof value === "number") void player.seek(value);
}

function togglePin(): void {
  void player.togglePinCurrent();
}

function cycleRepeat(): void {
  repeat.value = repeat.value === "off" ? "all" : repeat.value === "all" ? "one" : "off";
}

async function next(): Promise<void> {
  const t = queue.next();
  if (t) await player.play(t);
}

async function prev(): Promise<void> {
  const t = queue.prev();
  if (t) await player.play(t);
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
</script>

<style scoped>
.transport-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1200;
  padding: 8px 12px 12px;
  pointer-events: none;
}

.transport-bar:not(.compact) {
  left: 244px;
}

/* Sit above the bottom tab bar on mobile */
.transport-bar.has-tabbar {
  bottom: 56px;
  padding: 4px 8px;
}

.transport-shell {
  pointer-events: auto;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 2fr) minmax(220px, 1fr);
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  background: rgba(16, 18, 24, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  min-height: 64px;
}

/* Compact mobile pill */
.pill {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(16, 18, 24, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  cursor: pointer;
  min-height: 52px;
}

.pill-play {
  color: white;
}

.zone-now {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 8px;
}

.zone-now:hover {
  background: rgba(255, 255, 255, 0.04);
}

.now-art {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 6px;
  background: linear-gradient(135deg, #2a2e36, #1a1c22);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--am-text-muted);
  overflow: hidden;
}

.pill .now-art {
  width: 40px;
  height: 40px;
}

.now-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now-text {
  flex: 1;
  min-width: 0;
}

.now-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--am-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.now-artist {
  font-size: 11px;
  color: var(--am-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.now-expand {
  color: var(--am-text-muted);
}

.zone-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.transport-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

.play-btn {
  background: rgba(255, 255, 255, 0.95);
  color: #0a0c10;
}

.play-btn:hover {
  background: white;
}

.scrubber {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 600px;
}

.scrubber-slider {
  flex: 1;
}

.time-label {
  font-size: 11px;
  color: var(--am-text-muted);
  min-width: 36px;
  text-align: center;
}

.zone-extras {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}

.volume-slider {
  width: 100px;
}
</style>
