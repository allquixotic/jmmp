<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-dialog v-model="model">
    <q-card style="width: 480px; max-width: calc(100vw - 32px)">
      <q-card-section>
        <div class="text-h6">Import music to server</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input v-model="label" label="Name" autofocus dense class="q-mb-sm" />
        <p class="text-caption text-grey-6">
          Selected audio files are copied permanently to the jmmp server.
          They remain playable from any device after the original files move.
          Existing browser-only sources must be imported again.
        </p>
        <q-file v-model="files" multiple accept=".mp3,.flac,.ogg,.opus" label="Choose audio files" />
        <p v-if="progress" role="status">{{ progress }}</p>
      </q-card-section>
      <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
        {{ error }}
      </q-banner>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="model = false" />
        <q-btn flat :disable="working" label="Import folder…" @click="onPick" />
        <q-btn unelevated color="primary" :loading="working" :disable="!files?.length" label="Upload files" @click="onUpload" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useSourcesStore } from "src/stores/sources";
import { bindHandleToSource, pickLocalSource, scanLocalSource, uploadLocalFile } from "src/sources/local-fs";

const props = defineProps<{ modelValue: boolean; sourceId?: number | undefined }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean]; added: [] }>();

const model = ref(props.modelValue);
watch(() => props.modelValue, (v) => (model.value = v));
watch(model, (v) => emit("update:modelValue", v));

const sources = useSourcesStore();
const label = ref("Local music");
const error = ref<string | null>(null);
const working = ref(false);
const files = ref<File[] | null>(null);
const progress = ref("");
async function sourceId(): Promise<number> {
  if (props.sourceId) return props.sourceId;
  return (await sources.create({ kind: "local", name: label.value.trim() || "Local", config: { kind: "local", label: label.value.trim() || "Local" }, cachePolicy: "all" })).id;
}
async function onUpload() {
  working.value = true; error.value = null;
  try {
    const id = await sourceId(); let done = 0;
    for (const file of files.value ?? []) { progress.value = `Uploading ${file.name} (${++done}/${files.value!.length})`; await uploadLocalFile(id, file, file.webkitRelativePath || file.name); }
    emit("added"); model.value = false; files.value = null;
  } catch (e) { error.value = String(e); }
  finally { working.value = false; progress.value = ""; }
}

async function onPick(): Promise<void> {
  error.value = null;
  working.value = true;
  try {
    const picked = await pickLocalSource(label.value);
    const id = await sourceId();
    progress.value = "Uploading folder to server…";
    await bindHandleToSource(id, picked.handle);
    await scanLocalSource(id);
    emit("added");
    model.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    working.value = false; progress.value = "";
  }
}
</script>
