<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="pitch-control">
    <div class="control-row">
      <span class="control-label">{{ label }}</span>
      <q-input
        :model-value="modelValue"
        type="number"
        dense
        borderless
        input-class="text-right mono"
        :step="step"
        style="max-width: 80px"
        @update:model-value="onNumber"
      />
      <span class="control-unit mono">{{ unit }}</span>
      <q-btn flat dense round size="xs" icon="restart_alt" @click="reset">
        <q-tooltip>Reset</q-tooltip>
      </q-btn>
    </div>
    <q-slider
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      dense
      label
      color="primary"
      @update:model-value="onSlider"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: number;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}>();
const emit = defineEmits<{
  "update:modelValue": [v: number];
  input: [v: number];
}>();

function clamp(v: number): number {
  return Math.max(props.min, Math.min(props.max, v));
}

function onSlider(v: number | null): void {
  if (v === null) return;
  emit("update:modelValue", clamp(v));
  emit("input", clamp(v));
}

function onNumber(v: string | number | null): void {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  if (!Number.isFinite(n)) return;
  emit("update:modelValue", clamp(n));
  emit("input", clamp(n));
}

function reset(): void {
  emit("update:modelValue", 0);
  emit("input", 0);
}
</script>

<style scoped>
.pitch-control {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.control-label {
  width: 60px;
  font-weight: 500;
}
.control-unit {
  width: 24px;
  text-align: left;
  color: #8a8f99;
}
</style>
