<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <q-dialog v-model="model" :persistent="busy" @show="loadConnections">
    <q-card style="width: 520px; max-width: 95vw">
      <q-card-section><div class="text-h6">Import Spotify playlist</div></q-card-section>
      <q-card-section class="q-gutter-md">
        <p>Create an editable jmmp playlist from a Spotify playlist URL. Your saved Spotify connection supplies the tracks.</p>
        <q-linear-progress v-if="loading || busy" indeterminate />
        <template v-if="!loading && connections.length">
          <q-select v-if="connections.length > 1" v-model="sourceId" :options="connectionOptions"
            emit-value map-options label="Spotify connection" :disable="busy" />
          <p v-else>Connected as {{ connections[0]?.name }}</p>
          <q-input v-model="url" label="Spotify playlist URL" :disable="busy" autocomplete="off" />
          <p class="text-caption">This copies the playlist now. Later Spotify edits will not change your jmmp playlist.</p>
        </template>
        <template v-else-if="!loading && !error">
          <p>Connect your Spotify account in Sources first. You only need to sign in once.</p>
          <q-btn flat label="Connect Spotify" to="/sources" @click="model = false" />
        </template>
        <q-banner v-if="error" class="bg-red-1 text-red-10">{{ error }}</q-banner>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" v-close-popup :disable="busy" />
        <q-btn color="primary" label="Import playlist" :loading="busy"
          :disable="loading || !sourceId || !url.trim()" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import type { Playlist } from "@jmmp/shared";
import { useSourcesStore } from "src/stores/sources";
import { usePlaylistsStore } from "src/stores/playlists";

const model = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [playlist: Playlist] }>();
const sources = useSourcesStore(), playlists = usePlaylistsStore();
const loading = ref(false), busy = ref(false), url = ref("");
const sourceId = ref<number | null>(null), error = ref<string | null>(null);
const connections = computed(() => sources.sources.filter(source => source.kind === "spotify"));
const connectionOptions = computed(() => connections.value.map(source => ({ label: source.name, value: source.id })));

async function loadConnections() {
  error.value = null; url.value = ""; loading.value = true;
  try {
    await sources.load();
    sourceId.value = connections.value.find(source => source.id === sourceId.value)?.id ?? connections.value[0]?.id ?? null;
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function submit() {
  if (busy.value || loading.value || !sourceId.value || !url.value.trim()) return;
  error.value = null; busy.value = true;
  try {
    const playlist = await playlists.importSpotify(sourceId.value, url.value.trim());
    model.value = false; emit("imported", playlist);
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; }
}
</script>
