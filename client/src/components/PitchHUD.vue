<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div
    class="pitch-hud"
    :class="{ collapsed }"
    :style="positionStyle"
    @mousedown="onDragStart"
  >
    <div class="hud-header">
      <q-icon name="drag_indicator" size="20px" class="drag-handle" />
      <div class="text-caption mono" style="flex: 1">
        <span v-if="collapsed">
          P{{ fmt(hud.pitchSemi) }} T{{ fmt(hud.tempoPct) }} S{{ fmt(hud.speedPct) }}
        </span>
        <span v-else>Pitch · Tempo · Speed</span>
      </div>
      <q-btn flat dense round size="sm" :icon="collapsed ? 'expand_more' : 'expand_less'" @click="toggleCollapsed" />
    </div>
    <div v-if="!collapsed" class="hud-body">
      <PitchControl
        v-model="hud.pitchSemi"
        label="Pitch"
        unit="st"
        :min="-pitchMax"
        :max="pitchMax"
        :step="0.01"
        @input="onChange"
      />
      <PitchControl
        v-model="hud.tempoPct"
        label="Tempo"
        unit="%"
        :min="tempoMin"
        :max="tempoMax"
        :step="0.1"
        @input="onChange"
      />
      <PitchControl
        v-model="hud.speedPct"
        label="Speed"
        unit="%"
        :min="speedMin"
        :max="speedMax"
        :step="0.1"
        @input="onChange"
      />
      <q-btn flat dense size="sm" label="Reset all" icon="restart_alt" @click="resetAll" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useSettingsStore } from "src/stores/settings";
import { usePlayerStore } from "src/stores/player";
import {
  PITCH_RANGE_SEMI,
  TEMPO_PCT_MAX,
  TEMPO_PCT_MIN,
  SPEED_PCT_MAX,
  SPEED_PCT_MIN,
} from "@jmmp/shared";
import PitchControl from "./PitchControl.vue";

const settings = useSettingsStore();
const player = usePlayerStore();

const pitchMax = PITCH_RANGE_SEMI;
const tempoMin = TEMPO_PCT_MIN;
const tempoMax = TEMPO_PCT_MAX;
const speedMin = SPEED_PCT_MIN;
const speedMax = SPEED_PCT_MAX;

const hud = computed(() => settings.settings.pitchHud);
const collapsed = computed(() => hud.value.collapsed);

const positionStyle = computed(() => ({
  left: hud.value.x + "px",
  top: hud.value.y + "px",
}));

onMounted(async () => {
  if (!settings.loaded) {
    try {
      await settings.load();
    } catch {
      /* ignore */
    }
  }
  applyToPlayer();
});

watch(
  () => [hud.value.pitchSemi, hud.value.tempoPct, hud.value.speedPct],
  applyToPlayer
);

function applyToPlayer(): void {
  player.setParams({
    pitchSemi: hud.value.pitchSemi,
    tempoPct: hud.value.tempoPct,
    speedPct: hud.value.speedPct,
  });
}

function onChange(): void {
  settings.patch({ pitchHud: { ...hud.value } });
}

function toggleCollapsed(): void {
  settings.patch({ pitchHud: { ...hud.value, collapsed: !hud.value.collapsed } });
}

function resetAll(): void {
  settings.patch({
    pitchHud: { ...hud.value, pitchSemi: 0, tempoPct: 0, speedPct: 0 },
  });
}

function fmt(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(1);
}

// Drag handling
let dragStart: { x: number; y: number; hudX: number; hudY: number } | null = null;

function onDragStart(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target.closest(".drag-handle") && !target.classList.contains("hud-header")) return;
  dragStart = { x: e.clientX, y: e.clientY, hudX: hud.value.x, hudY: hud.value.y };
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
  e.preventDefault();
}

function onDragMove(e: MouseEvent): void {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  settings.patch({
    pitchHud: {
      ...hud.value,
      x: Math.max(0, dragStart.hudX + dx),
      y: Math.max(0, dragStart.hudY + dy),
    },
  });
}

function onDragEnd(): void {
  dragStart = null;
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
}
</script>

<style scoped>
.pitch-hud {
  position: fixed;
  z-index: 100;
  width: 320px;
  background: rgba(20, 22, 28, 0.92);
  color: #e6e8ee;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  font-size: 12px;
  user-select: none;
  backdrop-filter: blur(12px);
}
.pitch-hud.collapsed {
  width: auto;
  min-width: 200px;
}
.hud-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: move;
  gap: 4px;
}
.drag-handle {
  cursor: move;
}
.hud-body {
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
