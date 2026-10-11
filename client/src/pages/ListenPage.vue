<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <q-layout>
  <q-page-container><q-page class="q-pa-lg">
    <PageHero title="Live broadcast" subtitle="Listen to the server’s current playback." />
    <div class="q-pa-lg">
      <section aria-label="Now playing" aria-live="polite" class="q-mb-lg">
        <template v-if="nowPlaying">
          <div class="text-overline">Now playing</div>
          <h2 class="text-h4 q-mt-xs q-mb-sm">{{ nowPlaying.title || 'Untitled track' }}</h2>
          <p class="text-h6 q-mt-none">{{ nowPlaying.artist || 'Unknown artist' }}</p>
        </template>
        <p v-else-if="trackError" class="text-negative">{{ trackError }}</p>
        <p v-else>{{ loadingTrack ? 'Loading current track…' : 'Nothing playing right now.' }}</p>
      </section>
      <q-btn color="primary" :label="listening ? 'Disconnect' : 'Listen'" @click="toggle" />
      <p class="q-mt-md">{{ state }}</p>
      <p v-if="listening" role="status">{{ transport }}<span v-if="audio"> · {{ audio }}</span></p>
      <p v-if="error" role="alert" class="text-negative">{{ error }}</p>
      <q-btn v-if="!publicListener" flat label="Library" to="/" />
    </div>
  </q-page></q-page-container>
  </q-layout>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ListenerPlaybackStatus, NowPlayingTrack } from "@jmmp/shared";
import { api } from "src/api";
import { MoqPlayer } from "src/audio/moq";
import PageHero from "src/components/PageHero.vue";
const listening = ref(false), state = ref(""), error = ref("");
const transport = ref("Connecting"), audio = ref("");
const publicListener = useRoute().meta.publicListener === true;
const nowPlaying = ref<NowPlayingTrack | null>(null), loadingTrack = ref(true), trackError = ref("");
let polling: ReturnType<typeof setInterval> | undefined, pending: AbortController | undefined;
let active = true;
async function refreshTrack() {
  if (pending) return;
  const abort = pending = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5000);
  try {
    const status = await api.get<ListenerPlaybackStatus>(publicListener ? "/api/public/moq/status" : "/api/playback", { signal: abort.signal });
    if (active) { nowPlaying.value = status.nowPlaying; trackError.value = ""; }
  } catch {
    if (active) { nowPlaying.value = null; trackError.value = "Could not load the current track. Retrying…"; }
  } finally {
    clearTimeout(timeout); pending = undefined;
    if (active) loadingTrack.value = false;
  }
}
onMounted(() => { void refreshTrack(); polling = setInterval(() => void refreshTrack(), 1000); });
const player = new MoqPlayer(publicListener);
player.addEventListener("error", e => { error.value = (e as CustomEvent).detail; });
player.addEventListener("state", e => { state.value = (e as CustomEvent).detail; });
player.addEventListener("transport", e => { transport.value = (e as CustomEvent).detail; });
player.addEventListener("audio", e => { audio.value = (e as CustomEvent).detail; });
async function toggle() {
  if (listening.value) { player.dispose(); listening.value = false; state.value = "Disconnected"; audio.value = ""; transport.value = "Connecting"; return; }
  error.value = "";
  try { await player.listen(); listening.value = true; } catch (e) { error.value = String(e); }
}
onUnmounted(() => { active = false; clearInterval(polling); pending?.abort(); player.dispose(); });
</script>
