<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="nav-section">
    <div v-if="label" class="nav-section-header">
      <span class="nav-section-label">{{ label }}</span>
      <q-btn
        v-if="action"
        flat
        dense
        round
        size="xs"
        :icon="actionIcon ?? 'add'"
        @click="action"
      />
    </div>
    <div class="nav-section-items">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label?: string;
  action?: (() => void) | undefined;
  actionIcon?: string;
}>();
</script>

<style scoped>
.nav-section {
  padding: 6px 0;
}

.nav-section-header {
  display: flex;
  align-items: center;
  padding: 8px 16px 4px;
  gap: 4px;
}

.nav-section-label {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--am-text-muted);
}

.nav-section-items {
  display: flex;
  flex-direction: column;
}
</style>
