<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="list-filter">
    <q-input
      :model-value="modelValue"
      dense
      borderless
      :placeholder="placeholder ?? 'Filter'"
      class="list-filter-input"
      input-class="text-white"
      @update:model-value="onUpdate"
    >
      <template v-slot:prepend>
        <q-icon name="search" size="18px" />
      </template>
      <template v-slot:append>
        <q-icon
          v-if="modelValue"
          name="close"
          size="16px"
          class="cursor-pointer"
          @click="onUpdate('')"
        />
      </template>
    </q-input>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function onUpdate(v: string | number | null): void {
  emit("update:modelValue", v == null ? "" : String(v));
}
</script>

<style scoped>
.list-filter {
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 8px 16px;
  background: rgba(10, 12, 16, 0.85);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

@media (min-width: 600px) {
  .list-filter {
    padding: 10px 32px;
  }
}

.list-filter-input {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 4px 10px;
}

.list-filter-input :deep(.q-field__control) {
  min-height: 36px;
  height: 36px;
}

.list-filter-input :deep(input) {
  font-size: 14px;
}
</style>
