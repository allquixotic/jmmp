<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-dialog v-model="model">
    <q-card style="min-width: 480px">
      <q-card-section>
        <div class="text-h6">Add local directory source</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input v-model="label" label="Name" autofocus dense class="q-mb-sm" />
        <p class="text-caption text-grey-6">
          You'll be prompted by your browser to pick a directory. jmmp stores
          the chosen folder handle in this browser only — it never leaves the
          device.
        </p>
      </q-card-section>
      <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
        {{ error }}
      </q-banner>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="model = false" />
        <q-btn unelevated color="primary" :loading="working" label="Choose folder…" @click="onPick" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useSourcesStore } from "src/stores/sources";
import { bindHandleToSource, pickLocalSource, scanLocalSource } from "src/sources/local-fs";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean]; added: [] }>();

const model = ref(props.modelValue);
watch(() => props.modelValue, (v) => (model.value = v));
watch(model, (v) => emit("update:modelValue", v));

const sources = useSourcesStore();
const label = ref("Local music");
const error = ref<string | null>(null);
const working = ref(false);

async function onPick(): Promise<void> {
  error.value = null;
  working.value = true;
  try {
    const picked = await pickLocalSource(label.value);
    const source = await sources.create({
      kind: "local",
      name: label.value.trim() || "Local",
      config: { kind: "local", label: label.value.trim() || "Local" },
    });
    await bindHandleToSource(source.id, picked.handle);
    await scanLocalSource(source.id);
    emit("added");
    model.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    working.value = false;
  }
}
</script>
