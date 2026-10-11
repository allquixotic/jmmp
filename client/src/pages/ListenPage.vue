<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <q-layout>
  <q-page-container><q-page class="q-pa-lg">
    <PageHero title="Live broadcast" subtitle="Listen to the server’s current playback." />
    <div class="q-pa-lg">
      <q-btn color="primary" :label="listening ? 'Disconnect' : 'Listen'" @click="toggle" />
      <p class="q-mt-md">{{ state }}</p>
      <p v-if="error" role="alert" class="text-negative">{{ error }}</p>
      <q-btn v-if="!publicListener" flat label="Library" to="/" />
    </div>
  </q-page></q-page-container>
  </q-layout>
</template>
<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { MoqPlayer } from "src/audio/moq";
import PageHero from "src/components/PageHero.vue";
const listening = ref(false), state = ref(""), error = ref("");
const publicListener = useRoute().meta.publicListener === true;
const player = new MoqPlayer(publicListener);
player.addEventListener("error", e => { error.value = (e as CustomEvent).detail; });
player.addEventListener("state", e => { state.value = (e as CustomEvent).detail; });
async function toggle() {
  if (listening.value) { player.dispose(); listening.value = false; state.value = "Disconnected"; return; }
  error.value = "";
  try { await player.listen(); listening.value = true; } catch (e) { error.value = String(e); }
}
onUnmounted(() => player.dispose());
</script>
