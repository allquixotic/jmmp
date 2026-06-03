<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <header class="page-hero">
    <div class="page-hero-text">
      <div v-if="eyebrow" class="page-hero-eyebrow">{{ eyebrow }}</div>
      <h1 class="page-hero-title">{{ title }}</h1>
      <div v-if="subtitle" class="page-hero-subtitle">{{ subtitle }}</div>
    </div>
    <div class="page-hero-actions">
      <slot name="actions" />
      <q-btn
        v-if="viewToggle"
        flat
        round
        dense
        :icon="settings.settings.libraryView === 'list' ? 'view_module' : 'view_list'"
        class="page-hero-view-toggle"
        :aria-label="
          settings.settings.libraryView === 'list'
            ? 'Switch to grid view'
            : 'Switch to list view'
        "
        @click="toggleView"
      >
        <q-tooltip>
          {{ settings.settings.libraryView === "list" ? "Grid view" : "List view" }}
        </q-tooltip>
      </q-btn>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useSettingsStore } from "src/stores/settings";

defineProps<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  viewToggle?: boolean;
}>();

const settings = useSettingsStore();

function toggleView(): void {
  settings.patch({
    libraryView: settings.settings.libraryView === "list" ? "grid" : "list",
  });
}
</script>

<style scoped>
.page-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  flex-wrap: wrap;
}

@media (min-width: 600px) {
  .page-hero {
    gap: 16px;
    padding: 28px 32px 16px;
    flex-wrap: nowrap;
  }
}

.page-hero-eyebrow {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #ff6b87;
  margin-bottom: 4px;
}

.page-hero-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--am-text-primary);
  margin: 0;
  line-height: 1.1;
}

@media (min-width: 600px) {
  .page-hero-title {
    font-size: 32px;
  }
}

.page-hero-subtitle {
  font-size: 14px;
  color: var(--am-text-secondary);
  margin-top: 4px;
}

.page-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
