<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <div v-if="player.error || player.diagnostics.length" class="playback-diagnostics">
    <q-banner v-if="player.error" role="alert" class="bg-red-1 text-red-10" dense rounded>
      <pre>{{ player.error }}</pre>
    </q-banner>
    <details v-if="player.diagnostics.length">
      <summary>Skipped tracks ({{ player.diagnostics.length }}) — errors and stack traces</summary>
      <div class="diagnostics-history">
        <q-btn flat dense label="Clear diagnostics" @click="player.diagnostics = []" />
        <article v-for="(failure, i) in player.diagnostics" :key="`${failure.at}:${i}`">
          <strong>{{ failure.title }}<template v-if="failure.artist"> — {{ failure.artist }}</template></strong>
          <span> · {{ new Date(failure.at).toLocaleTimeString() }}</span>
          <pre>{{ failure.error }}</pre>
        </article>
      </div>
    </details>
  </div>
</template>
<script setup lang="ts">
import { usePlayerStore } from "src/stores/player";
const player = usePlayerStore();
</script>
<style scoped>
.playback-diagnostics { pointer-events: auto; font-size: 12px; margin-bottom: 6px; }
details { padding: 8px 12px; background: #181b22; border: 1px solid #50535b; border-radius: 8px; }
summary { cursor: pointer; }
.diagnostics-history { max-height: 35vh; overflow: auto; }
article { border-top: 1px solid #50535b; padding: 8px 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; user-select: text; }
</style>
