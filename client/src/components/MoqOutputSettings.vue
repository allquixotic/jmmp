<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <div class="q-pa-md">
    <q-toggle v-model="draft.enabled" :disable="!status" label="Enable MoQ output" />
    <p class="text-caption">When enabled, the server plays your music and this browser listens to the same Opus broadcast as other listeners. Audio caching and offline playback are unavailable in this mode.</p>
    <q-input v-model="draft.publicUrl" :disable="!status" label="Relay URL for listeners" hint="Use HTTPS for remote listeners. HTTP is allowed on localhost." />
    <div class="row q-col-gutter-md">
      <q-input class="col" v-model="draft.bind" :disable="!status" label="Listen address" hint="127.0.0.1 for local use; 0.0.0.0 for remote connections" />
      <q-input class="col" v-model.number="draft.port" :disable="!status" type="number" label="Relay port (TCP and UDP)" />
    </div>
    <q-input v-model="draft.certPath" :disable="!status" label="TLS certificate path on server" hint="PEM certificate chain, required for HTTPS" />
    <q-input v-model="draft.keyPath" :disable="!status" label="TLS private key path on server" />
    <q-select v-model="draft.bitrate" :disable="!status" :options="bitrates" emit-value map-options label="Opus bitrate" />
    <q-banner v-if="error" class="bg-red-1 text-red-10 q-my-md" rounded>{{ error }}</q-banner>
    <p v-if="result" role="status" class="text-positive q-mt-md">{{ result }}</p>
    <p v-if="status" class="text-caption">Relay: {{ status.running ? 'running' : 'stopped' }}<span v-if="status.error"> · {{ status.error }}</span></p>
    <div class="row q-gutter-sm q-mt-md">
      <q-btn outline label="Test connection" :loading="testing" :disable="saving || !status" @click="testConnection" />
      <q-btn color="primary" label="Save" :loading="saving" :disable="testing || !status" @click="save" />
      <q-btn v-if="status?.settings.enabled" flat label="Open listener" href="/listen" target="_blank" rel="noopener" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { DEFAULT_MOQ_SETTINGS, validateMoqSettings, type MoqListener, type MoqOutputStatus } from "@jmmp/shared";
import { api } from "src/api";
import { testMoqConnection } from "src/audio/moq";
import { usePlayerStore } from "src/stores/player";
const draft = reactive({ ...DEFAULT_MOQ_SETTINGS });
const status = ref<MoqOutputStatus>();
const error = ref<string>(), result = ref<string>();
const testing = ref(false), saving = ref(false);
const bitrates = [64000, 96000, 128000, 192000, 256000, 320000].map(value => ({ value, label: `${value / 1000} kbps` }));
onMounted(async () => { try { status.value = await api.get<MoqOutputStatus>("/api/moq"); Object.assign(draft, status.value.settings); } catch (e) { error.value = String(e); } });
async function testConnection() {
  testing.value = true; error.value = undefined; result.value = undefined;
  try {
    const listener = await api.post<MoqListener>("/api/moq/test", validateMoqSettings(draft));
    const transport = await testMoqConnection(listener);
    result.value = `Connected and subscribed successfully over ${transport}.`;
  } catch (e) { error.value = String(e); }
  finally { await api.post("/api/moq/test/end").catch(() => {}); testing.value = false; }
}
async function save() {
  saving.value = true; error.value = undefined;
  try {
    status.value = await api.put<MoqOutputStatus>("/api/moq", validateMoqSettings(draft));
    await usePlayerStore().refreshOutput(); result.value = "MoQ settings saved.";
  } catch (e) { error.value = String(e); }
  finally { saving.value = false; }
}
</script>
