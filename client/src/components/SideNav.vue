<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="side-nav">
    <div class="side-nav-brand">
      <span class="mono">jmmp</span>
    </div>

    <q-input
      v-model="searchValue"
      dense
      borderless
      placeholder="Search"
      class="side-nav-search"
      input-class="text-white"
      @keyup.enter="onSearchEnter"
    >
      <template v-slot:prepend>
        <q-icon name="search" size="18px" />
      </template>
      <template v-slot:append>
        <q-btn
          v-if="searchValue"
          flat
          round
          dense
          size="xs"
          icon="close"
          aria-label="Clear search"
          @click="clearSearch"
        />
      </template>
    </q-input>

    <q-scroll-area class="side-nav-scroll">
      <NavSection label="">
        <NavItem icon="home" label="Home" :to="{ name: 'home' }" />
        <NavItem icon="explore" label="Browse" :to="{ name: 'browse' }" />
      </NavSection>

      <NavSection label="Library">
        <NavItem icon="album" label="Albums" :to="{ name: 'library-albums' }" />
        <NavItem icon="person" label="Artists" :to="{ name: 'library-artists' }" />
        <NavItem icon="music_note" label="Songs" :to="{ name: 'library-songs' }" />
        <NavItem icon="schedule" label="Recently Added" :to="{ name: 'library-recent' }" />
      </NavSection>

      <NavSection label="Playlists" :action="onCreatePlaylist" action-icon="add">
        <NavItem
          v-for="p in playlists.playlists"
          :key="p.id"
          icon="queue_music"
          :label="p.name"
          :trailing-icon="p.pinnedAt ? 'push_pin' : undefined"
          :to="{ name: 'playlist', params: { id: String(p.id) } }"
        />
      </NavSection>

      <NavSection label="Setup">
        <NavItem icon="cloud" label="Sources" :to="{ name: 'sources' }" />
        <NavItem icon="tune" label="Settings" :to="{ name: 'settings' }" />
      </NavSection>
    </q-scroll-area>

    <div class="side-nav-footer">
      <q-btn flat dense no-caps class="side-nav-account" @click="logout">
        <q-icon name="logout" size="16px" class="q-mr-sm" />
        <span class="text-caption">Sign out</span>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePlaylistsStore } from "src/stores/playlists";
import { useSessionStore } from "src/stores/session";
import NavSection from "./NavSection.vue";
import NavItem from "./NavItem.vue";

const router = useRouter();
const route = useRoute();
const playlists = usePlaylistsStore();
const session = useSessionStore();
const searchValue = ref("");

watch(
  () => route.query.q,
  (value) => {
    searchValue.value = routeSearchValue(value);
  },
  { immediate: true }
);

onMounted(async () => {
  try {
    if (!playlists.loaded) await playlists.load();
  } catch {
    /* ignore */
  }
});

async function onSearchEnter(): Promise<void> {
  const q = searchValue.value.trim();
  if (!q) {
    await clearSearch();
    return;
  }
  if (route.name === "search" && routeSearchValue(route.query.q) === q) return;
  await router.push({ name: "search", query: { q } });
}

async function clearSearch(): Promise<void> {
  searchValue.value = "";
  if (route.name !== "search" || routeSearchValue(route.query.q) === "") return;

  const query = { ...route.query };
  delete query.q;
  await router.push({ name: "search", query });
}

function routeSearchValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

async function onCreatePlaylist(): Promise<void> {
  const name = window.prompt("Playlist name:");
  if (!name?.trim()) return;
  try {
    const p = await playlists.create(name.trim());
    await router.push({ name: "playlist", params: { id: String(p.id) } });
  } catch (err) {
    console.error(err);
  }
}

async function logout(): Promise<void> {
  await session.logout();
  await router.push({ name: "login" });
}
</script>

<style scoped>
.side-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--am-text-primary);
}

.side-nav-brand {
  padding: 14px 16px 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.side-nav-search {
  margin: 4px 12px 12px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.side-nav-search :deep(.q-field__control) {
  min-height: 30px;
  height: 30px;
}

.side-nav-search :deep(input) {
  font-size: 13px;
}

.side-nav-scroll {
  flex: 1;
  min-height: 0;
}

.side-nav-footer {
  padding: 8px 12px 12px;
  border-top: 1px solid var(--am-sidebar-border);
}

.side-nav-account {
  width: 100%;
  justify-content: flex-start;
  color: var(--am-text-secondary);
}
</style>
