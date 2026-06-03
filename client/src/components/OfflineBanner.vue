<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-banner v-if="!online" inline-actions class="bg-amber-1 text-amber-10" dense>
    <template v-slot:avatar><q-icon name="wifi_off" /></template>
    Offline — cached tracks and local files can play. Server streams and library changes need a connection.
  </q-banner>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const online = ref(navigator.onLine);

function onChange(): void {
  online.value = navigator.onLine;
}

onMounted(() => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
});

onUnmounted(() => {
  window.removeEventListener("online", onChange);
  window.removeEventListener("offline", onChange);
});
</script>
