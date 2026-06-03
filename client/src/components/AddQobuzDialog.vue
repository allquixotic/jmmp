<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-dialog v-model="model">
    <q-card style="width: min(480px, 92vw)">
      <q-card-section>
        <div class="text-h6">Add Qobuz source</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input v-model="name" label="Name" autofocus dense class="q-mb-sm" placeholder="Qobuz" />
        <div class="text-body2 text-grey-8 q-mt-sm">
          Sign in on Qobuz, then return here after the source is connected.
          jmmp stores only the resulting auth token, machine-key encrypted.
        </div>
      </q-card-section>
      <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
        {{ error }}
      </q-banner>
      <q-banner v-if="oauthUrl" class="bg-blue-1 text-blue-10 q-ma-md" dense rounded>
        <div>Waiting for Qobuz sign-in to finish.</div>
        <a :href="oauthUrl" target="_blank" rel="noopener">Open Qobuz sign-in</a>
      </q-banner>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="model = false" />
        <q-btn
          v-if="oauthUrl"
          flat
          label="Refresh"
          :loading="refreshing"
          @click="checkOAuthStatus"
        />
        <q-btn
          unelevated
          color="primary"
          icon="open_in_new"
          :loading="working"
          :label="oauthUrl ? 'Open again' : 'Open Qobuz'"
          @click="onSubmit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import type { QobuzOAuthStartResponse, QobuzOAuthStatusResponse } from "@jmmp/shared";
import { onBeforeUnmount, ref, watch } from "vue";
import { api } from "src/api";
import { useSourcesStore } from "src/stores/sources";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean]; added: [] }>();

const model = ref(props.modelValue);
watch(() => props.modelValue, (v) => (model.value = v));

const name = ref("Qobuz");
const error = ref<string | null>(null);
const working = ref(false);
const refreshing = ref(false);
const oauthUrl = ref<string | null>(null);
const oauthState = ref<string | null>(null);

const sources = useSourcesStore();
let pollId: ReturnType<typeof window.setInterval> | null = null;

watch(model, (open) => {
  emit("update:modelValue", open);
  if (!open) stopPolling();
  if (open) {
    error.value = null;
    oauthUrl.value = null;
    oauthState.value = null;
  }
});

window.addEventListener("message", onOAuthMessage);
onBeforeUnmount(() => {
  window.removeEventListener("message", onOAuthMessage);
  stopPolling();
});

async function onSubmit(): Promise<void> {
  error.value = null;
  if (oauthUrl.value) {
    openOAuthWindow(oauthUrl.value);
    return;
  }
  working.value = true;
  const pendingWindow = openBlankOAuthWindow();
  try {
    const resp = await api.post<QobuzOAuthStartResponse>("/api/sources/qobuz/oauth/start", {
      sourceName: name.value.trim() || "Qobuz",
    });
    oauthUrl.value = resp.authUrl;
    oauthState.value = resp.state;
    startPolling();
    navigateOAuthWindow(resp.authUrl, pendingWindow);
  } catch (err) {
    pendingWindow?.close();
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    working.value = false;
  }
}

async function checkOAuthStatus(): Promise<void> {
  if (!oauthState.value) return;
  refreshing.value = true;
  try {
    const status = await api.get<QobuzOAuthStatusResponse>(
      `/api/sources/qobuz/oauth/status/${encodeURIComponent(oauthState.value)}`
    );
    if (status.status === "complete") {
      await completeOAuth();
    } else if (status.status === "error") {
      error.value = status.error;
      stopPolling();
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    stopPolling();
  } finally {
    refreshing.value = false;
  }
}

async function completeOAuth(): Promise<void> {
  stopPolling();
  await sources.load();
  emit("added");
  model.value = false;
}

function openOAuthWindow(url: string): void {
  navigateOAuthWindow(url, openBlankOAuthWindow());
}

function openBlankOAuthWindow(): Window | null {
  return window.open("about:blank", "jmmp-qobuz-oauth", "width=520,height=740");
}

function navigateOAuthWindow(url: string, opened: Window | null): void {
  if (!opened) {
    error.value = "Browser blocked the Qobuz window. Use the sign-in link below.";
    return;
  }
  opened.location.href = url;
}

function startPolling(): void {
  stopPolling();
  pollId = window.setInterval(() => {
    void checkOAuthStatus();
  }, 1000);
}

function stopPolling(): void {
  if (pollId !== null) {
    window.clearInterval(pollId);
    pollId = null;
  }
}

function onOAuthMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin || !isRecord(event.data)) return;
  const type = event.data["type"];
  if (type === "jmmp:qobuz-connected") {
    void completeOAuth();
  } else if (type === "jmmp:qobuz-error") {
    error.value =
      typeof event.data["message"] === "string"
        ? event.data["message"]
        : "Qobuz sign-in failed.";
    stopPolling();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
</script>
