<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-tabs
    :model-value="active"
    @update:model-value="onSelect"
    dense
    inline-label
    indicator-color="transparent"
    active-color="primary"
    class="am-tabbar"
    :align="$q.screen.xs ? 'justify' : 'center'"
  >
    <q-route-tab name="home" icon="home" label="Home" :to="{ name: 'home' }" />
    <q-route-tab name="library" icon="library_music" label="Library" :to="{ name: 'library-albums' }" />
    <q-route-tab name="playlists" icon="queue_music" label="Playlists" :to="{ name: 'playlists' }" />
    <q-route-tab name="search" icon="search" label="Search" :to="{ name: 'search' }" />
    <q-route-tab name="more" icon="settings" label="More" :to="{ name: 'settings' }" />
  </q-tabs>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();

const active = computed(() => {
  const n = String(route.name ?? "");
  if (n === "home") return "home";
  if (n.startsWith("library")) return "library";
  if (n === "playlists" || n === "playlist") return "playlists";
  if (n === "search") return "search";
  return "more";
});

function onSelect(_v: string | number | null): void {
  /* router-driven; q-route-tab handles navigation via :to */
}
</script>

<style scoped>
.am-tabbar {
  background: rgba(16, 18, 24, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--am-text-secondary);
}

.am-tabbar :deep(.q-tab) {
  font-size: 10px;
  min-height: 56px;
  padding: 4px 8px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.am-tabbar :deep(.q-tab__icon) {
  font-size: 22px;
}

.am-tabbar :deep(.q-tab--active) {
  color: #ff6b87;
}
</style>
