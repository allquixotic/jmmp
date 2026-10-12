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
      <q-btn color="primary" :disable="resyncing" :label="listening ? 'Disconnect' : 'Listen'" @click="toggle" />
      <q-btn v-if="listening" class="q-ml-sm" outline color="primary" label="Resync" :loading="resyncing" @click="resync">
        <q-tooltip>Reset learned buffer and reconnect</q-tooltip>
      </q-btn>
      <p class="q-mt-md">{{ state }}</p>
      <p v-if="listening" role="status">{{ transport }}<span v-if="audio"> · {{ audio }}</span></p>
      <p v-if="listening && latency" aria-label="Adaptive playback buffer" class="text-grey">
        Adaptive buffer: {{ Math.round(latency.playoutMs) }} ms
        <span v-if="latency.buffering"> · Buffering…</span>
      </p>
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
import type { ListenerLatency } from "src/audio/adaptive-latency";
import PageHero from "src/components/PageHero.vue";
const listening = ref(false), state = ref(""), error = ref("");
const resyncing = ref(false);
const transport = ref("Connecting"), audio = ref("");
const latency = ref<ListenerLatency | null>(null);
const publicListener = useRoute().meta.publicListener === true;
const nowPlaying = ref<NowPlayingTrack | null>(null), loadingTrack = ref(true), trackError = ref("");
let polling: ReturnType<typeof setInterval> | undefined, pending: AbortController | undefined;
let active = true;
async function refreshTrack() {
  if (pending || listening.value) return;
  const abort = pending = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5000);
  try {
    const status = await api.get<ListenerPlaybackStatus>(publicListener ? "/api/public/moq/status" : "/api/playback", { signal: abort.signal });
    if (active && !listening.value) { nowPlaying.value = status.nowPlaying; trackError.value = ""; }
  } catch {
    if (active && !listening.value) { nowPlaying.value = null; trackError.value = "Could not load the current track. Retrying…"; }
  } finally {
    clearTimeout(timeout); pending = undefined;
    if (active) loadingTrack.value = false;
  }
}
onMounted(() => { void refreshTrack(); polling = setInterval(() => void refreshTrack(), 1000); });
const player = new MoqPlayer(publicListener, true);
player.addEventListener("error", e => { error.value = (e as CustomEvent).detail; });
player.addEventListener("state", e => {
  const next = (e as CustomEvent<string>).detail;
  state.value = ({ idle: "Waiting for next track…", ended: "Waiting for next track…", loading: "Waiting for audio…",
    paused: "Playback paused", playing: "Listening", error: "Waiting for broadcast to recover…" } as Record<string, string>)[next] ?? next;
});
player.addEventListener("status", e => {
  const status = (e as CustomEvent<ListenerPlaybackStatus>).detail;
  nowPlaying.value = status.nowPlaying; trackError.value = ""; loadingTrack.value = false;
});
player.addEventListener("transport", e => { transport.value = (e as CustomEvent).detail; });
player.addEventListener("audio", e => { audio.value = (e as CustomEvent).detail; });
player.addEventListener("latency", e => { latency.value = (e as CustomEvent<ListenerLatency>).detail; });
async function toggle() {
  if (listening.value) { player.dispose(); listening.value = false; state.value = "Disconnected"; audio.value = ""; transport.value = "Connecting"; latency.value = null; void refreshTrack(); return; }
  error.value = "";
  try { await player.listen(); listening.value = true; } catch (e) { error.value = String(e); }
}
async function resync() {
  if (resyncing.value) return;
  resyncing.value = true; transport.value = "Connecting"; audio.value = "";
  try { await player.resync(); } finally { resyncing.value = false; }
}
onUnmounted(() => { active = false; clearInterval(polling); pending?.abort(); player.dispose(); });
</script>
