<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-layout view="lHh LpR fFf" class="am-layout">
    <!-- Mobile header: brand + search affordance. Hidden on tablet/desktop. -->
    <q-header v-if="$q.screen.lt.md" class="am-mobile-header" elevated>
      <q-toolbar>
        <q-toolbar-title class="mono text-weight-bold">jmmp</q-toolbar-title>
        <q-btn flat round dense icon="search" :to="{ name: 'search' }" />
        <q-btn flat round dense icon="logout" @click="logout">
          <q-tooltip>Sign out</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <!-- Sidebar: only on tablet+ -->
    <q-drawer
      v-if="$q.screen.gt.sm"
      v-model="sidebarOpen"
      show-if-above
      bordered
      side="left"
      :width="244"
      class="am-sidebar"
    >
      <SideNav />
    </q-drawer>

    <q-page-container>
      <OfflineBanner />
      <q-banner
        v-if="session.playerConflict"
        inline-actions
        dense
        class="bg-blue-grey-10 text-white"
      >
        <template v-slot:avatar><q-icon name="phonelink_ring" /></template>
        Another tab or device has player control.
        <template v-slot:action>
          <q-btn flat dense label="Take control" @click="takeControl" />
        </template>
      </q-banner>
      <router-view />
    </q-page-container>

    <!-- Transport: always visible. Compact on mobile. -->
    <TransportBar
      :compact="$q.screen.lt.md"
      @open-now-playing="nowPlayingOpen = true"
    />

    <!-- Mobile bottom tab bar; sits beneath the transport pill. -->
    <q-footer v-if="$q.screen.lt.md">
      <TabBar />
    </q-footer>

    <NowPlayingScreen v-model:open="nowPlayingOpen" />
    <PitchHUD v-if="$q.screen.gt.sm && session.canControl" />
  </q-layout>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useSessionStore } from "src/stores/session";
import { usePlayerStore } from "src/stores/player";
import { handlePlaybackShortcut } from "src/interactions/playback-shortcut";
import SideNav from "src/components/SideNav.vue";
import TabBar from "src/components/TabBar.vue";
import TransportBar from "src/components/TransportBar.vue";
import NowPlayingScreen from "src/components/NowPlayingScreen.vue";
import OfflineBanner from "src/components/OfflineBanner.vue";
import PitchHUD from "src/components/PitchHUD.vue";

const sidebarOpen = ref(true);
const nowPlayingOpen = ref(false);
const session = useSessionStore();
const player = usePlayerStore();
const router = useRouter();

onMounted(() => {
  player.startObserving();
  document.addEventListener("keydown", onPlaybackKeydown);
});

onBeforeUnmount(() => {
  player.stopObserving();
  document.removeEventListener("keydown", onPlaybackKeydown);
});

watch(
  () => session.playerConflict,
  (conflict) => {
    if (conflict && player.state === "playing" && !session.me?.moqEnabled) player.releaseLocalAudio();
  }
);
watch(() => session.canControl, allowed => { if (!allowed) player.releaseLocalAudio(); });
watch(() => session.hasFullSession, signedIn => { if (!signedIn) { player.releaseLocalAudio(); void router.replace({ name: "login" }); } });

function takeControl(): void {
  void session.takePlayerControl();
}

function onPlaybackKeydown(event: KeyboardEvent): void {
  if (!session.canControl) return;
  handlePlaybackShortcut(event, () => void player.toggle());
}

async function logout(): Promise<void> {
  await session.logout();
  await router.push({ name: "login" });
}
</script>

<style>
.am-layout {
  --am-sidebar-bg: rgba(20, 22, 28, 0.72);
  --am-sidebar-border: rgba(255, 255, 255, 0.06);
  --am-content-bg: #0a0c10;
  --am-text-primary: #e6e8ee;
  --am-text-secondary: #9aa0a8;
  --am-text-muted: #6a7079;
  --am-accent: #ff2d55;
  --am-row-hover: rgba(255, 255, 255, 0.05);
  --am-card-bg: rgba(255, 255, 255, 0.03);
  --am-card-border: rgba(255, 255, 255, 0.07);

  background: var(--am-content-bg);
  color: var(--am-text-primary);
  min-height: 100vh;
}

.am-sidebar {
  background: var(--am-sidebar-bg) !important;
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-right: 1px solid var(--am-sidebar-border) !important;
}

.am-mobile-header {
  background: rgba(16, 18, 24, 0.9) !important;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--am-sidebar-border);
}

.am-mobile-header .q-toolbar-title {
  font-size: 18px;
  letter-spacing: -0.02em;
}

/* Page container padding: leave room for the transport pill, plus the tab bar on mobile. */
.am-layout .q-page-container {
  padding-bottom: 96px;
}

.screen--xs .am-layout .q-page-container,
.screen--sm .am-layout .q-page-container {
  padding-bottom: 140px; /* mini-player pill + tab bar */
}

.am-layout .q-page {
  padding: 0;
}

.am-layout a {
  color: inherit;
}

/* Quasar's q-footer wraps the tab bar; ensure transparent background so the
   pill transport visually floats above it. */
.am-layout .q-footer {
  background: transparent !important;
  box-shadow: none !important;
}
</style>
