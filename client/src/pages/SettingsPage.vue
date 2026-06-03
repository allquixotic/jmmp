<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero title="Settings" />

    <div class="settings-section">
      <h2 class="settings-section-title">Audio</h2>
      <div class="settings-list">
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-title">ReplayGain</div>
            <div class="settings-row-desc">Volume normalization from embedded tags.</div>
          </div>
          <q-btn-dropdown flat :label="rgLabel">
            <q-list>
              <q-item clickable v-close-popup @click="setRgMode('off')"><q-item-section>Off</q-item-section></q-item>
              <q-item clickable v-close-popup @click="setRgMode('track')"><q-item-section>Track</q-item-section></q-item>
              <q-item clickable v-close-popup @click="setRgMode('album')"><q-item-section>Album</q-item-section></q-item>
              <q-item clickable v-close-popup @click="setRgMode('album-fallback-track')"><q-item-section>Album, fallback to track</q-item-section></q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h2 class="settings-section-title">Account</h2>
      <q-list bordered separator class="settings-card">
        <q-item clickable :to="{ name: 'passkeys' }">
          <q-item-section avatar><q-icon name="key" /></q-item-section>
          <q-item-section>
            <q-item-label>Passkeys</q-item-label>
            <q-item-label caption>Manage WebAuthn credentials.</q-item-label>
          </q-item-section>
          <q-item-section side><q-icon name="chevron_right" /></q-item-section>
        </q-item>
      </q-list>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useSettingsStore } from "src/stores/settings";
import type { ReplayGainMode } from "@jmmp/shared";
import PageHero from "src/components/PageHero.vue";

const settings = useSettingsStore();

onMounted(async () => {
  if (!settings.loaded) {
    try {
      await settings.load();
    } catch {
      /* ignore */
    }
  }
});

const rgLabel = computed(() => {
  switch (settings.settings.replayGainMode) {
    case "off":
      return "Off";
    case "track":
      return "Track";
    case "album":
      return "Album";
    case "album-fallback-track":
      return "Album, fallback to track";
  }
});

function setRgMode(mode: ReplayGainMode): void {
  settings.patch({ replayGainMode: mode });
}
</script>

<style scoped>
.settings-section {
  padding: 16px 32px 32px;
}

.settings-section-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 16px 0 12px;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-row {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  background: var(--am-card-bg);
  border: 1px solid var(--am-card-border);
  border-radius: 10px;
  gap: 16px;
}

.settings-row-label {
  flex: 1;
}

.settings-row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--am-text-primary);
}

.settings-row-desc {
  font-size: 12px;
  color: var(--am-text-secondary);
}

.settings-card {
  background: var(--am-card-bg);
  border: 1px solid var(--am-card-border);
  border-radius: 10px;
}
</style>
