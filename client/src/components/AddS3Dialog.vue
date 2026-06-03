<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-dialog v-model="model">
    <q-card style="min-width: 480px">
      <q-card-section>
        <div class="text-h6">Add S3 source</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input v-model="name" label="Name" autofocus dense class="q-mb-sm" />
        <q-input v-model="endpoint" label="Endpoint URL" placeholder="https://s3.example.com" dense class="q-mb-sm" />
        <q-input v-model="region" label="Region" placeholder="us-east-1" dense class="q-mb-sm" />
        <q-input v-model="bucket" label="Bucket" dense class="q-mb-sm" />
        <q-input v-model="prefix" label="Prefix (optional)" dense class="q-mb-sm" />
        <q-toggle v-model="pathStyle" label="Use path-style URLs (MinIO etc.)" class="q-mb-sm" />
        <q-input v-model="accessKeyId" label="Access key ID" dense class="q-mb-sm" />
        <q-input v-model="secretAccessKey" label="Secret access key" type="password" dense />
      </q-card-section>
      <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
        {{ error }}
      </q-banner>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="model = false" />
        <q-btn unelevated color="primary" :loading="working" label="Add" @click="onSubmit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useSourcesStore } from "src/stores/sources";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean]; added: [] }>();

const model = ref(props.modelValue);
const sources = useSourcesStore();
const name = ref("");
const endpoint = ref("https://s3.amazonaws.com");
const region = ref("us-east-1");
const bucket = ref("");
const prefix = ref("");
const pathStyle = ref(false);
const accessKeyId = ref("");
const secretAccessKey = ref("");
const error = ref<string | null>(null);
const working = ref(false);

function sync() {
  emit("update:modelValue", model.value);
}
watch(() => props.modelValue, (v) => (model.value = v));
watch(model, sync);

async function onSubmit(): Promise<void> {
  error.value = null;
  working.value = true;
  try {
    await sources.create({
      kind: "s3",
      name: name.value.trim() || bucket.value,
      config: {
        kind: "s3",
        endpoint: endpoint.value,
        region: region.value,
        bucket: bucket.value,
        prefix: prefix.value || undefined,
        pathStyle: pathStyle.value,
      },
      secrets: {
        kind: "s3",
        accessKeyId: accessKeyId.value,
        secretAccessKey: secretAccessKey.value,
      },
    });
    emit("added");
    model.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    working.value = false;
  }
}
</script>

<script lang="ts">
import { watch } from "vue";
</script>
