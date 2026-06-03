<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="album-cover" :style="sizeStyle">
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      loading="lazy"
      decoding="async"
      @error="onImageError"
    />
    <q-icon v-else name="album" size="40%" class="album-cover-fallback" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { artUrl } from "src/storage/art-cache";

const props = defineProps<{
  hash?: string | null;
  alt?: string;
  size?: number;
}>();

const src = ref<string | null>(null);
let artRequestId = 0;

watch(
  () => props.hash,
  async (h) => {
    const requestId = ++artRequestId;
    src.value = null;
    const nextSrc = h ? await artUrl(h) : null;
    if (requestId === artRequestId) src.value = nextSrc;
  },
  { immediate: true }
);

function onImageError(): void {
  src.value = null;
}

const sizeStyle = computed(() =>
  props.size ? { width: props.size + "px", height: props.size + "px" } : {}
);
</script>

<style scoped>
.album-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(135deg, #2a2e36, #1a1c22);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: transform 160ms ease;
}

.album-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.album-cover-fallback {
  pointer-events: none;
}
</style>
