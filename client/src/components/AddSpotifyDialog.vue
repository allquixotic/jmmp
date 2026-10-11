<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <q-dialog v-model="model">
    <q-card style="width: 560px; max-width: 95vw">
      <q-card-section><div class="text-h6">Add Spotify</div></q-card-section>
      <q-card-section class="q-gutter-md">
        <p>Sign in to your Spotify Premium account. You do not need to create a developer application.</p>
        <p>Connect your account once. You can import playlist URLs later from Playlists.</p>
        <q-input v-model="name" label="Source name" :disable="!!state" />
        <q-expansion-item v-if="!state" label="Advanced: use your own Spotify application" dense>
          <div class="q-gutter-md q-pa-sm">
            <p>Optional: enter your application's client ID and register this redirect URI in the Spotify developer dashboard.</p>
            <q-input :model-value="customRedirectUri" readonly label="Custom application redirect URI" />
            <q-input v-model="clientId" label="Application client ID (optional)" />
          </div>
        </q-expansion-item>
        <q-banner v-if="error" class="bg-red-1 text-red-10">{{ error }}</q-banner>
        <template v-if="state && manualCallback">
          <p>Finish signing in to Spotify. It will redirect to a local address that may show “Unable to connect”. Copy that entire URL from the address bar and paste it below, then finish the connection.</p>
          <q-input v-model="redirectUrl" type="textarea" label="Final redirect URL" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </template>
        <p v-else-if="state">Finish signing in to Spotify, then return here.</p>
        <a v-if="authUrl" :href="authUrl" target="jmmp-spotify-oauth" rel="noopener">Open Spotify sign-in</a>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" v-close-popup />
        <q-btn v-if="state" flat label="Start again" @click="reset" />
        <q-btn color="primary" :label="state ? (manualCallback ? 'Finish connection' : 'Check sign-in') : 'Sign in to Spotify'"
          :disable="!!state && manualCallback && !redirectUrl.trim()" :loading="working" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { api } from "src/api";

const model = defineModel<boolean>({ required: true });
const emit = defineEmits<{ added: [] }>();
const name = ref("Spotify"), clientId = ref(""), error = ref<string | null>(null);
const state = ref(""), authUrl = ref(""), working = ref(false), manualCallback = ref(true), redirectUrl = ref("");
const customRedirectUri = `${window.location.origin}/api/sources/spotify/oauth/callback`;
let poll: ReturnType<typeof setInterval> | undefined;

function reset() {
  clearInterval(poll); poll = undefined; state.value = ""; authUrl.value = "";
  redirectUrl.value = ""; error.value = null; manualCallback.value = true;
}
function added() { emit("added"); model.value = false; }
watch(model, value => { if (!value) reset(); });
onBeforeUnmount(reset);

async function check() {
  if (!state.value || working.value) return;
  working.value = true;
  try {
    const result = await api.get<{ status: string; error?: string }>(`/api/sources/spotify/oauth/status/${encodeURIComponent(state.value)}`);
    if (result.status === "complete") added();
    else if (result.status === "error") { error.value = result.error ?? "Spotify sign-in failed"; clearInterval(poll); }
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); clearInterval(poll); }
  finally { working.value = false; }
}

async function submit() {
  if (working.value) return;
  if (state.value) {
    if (!manualCallback.value) { await check(); return; }
    error.value = null; working.value = true;
    try {
      await api.post("/api/sources/spotify/oauth/complete", { state: state.value, redirectUrl: redirectUrl.value.trim() });
      added();
    } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
    finally { working.value = false; }
    return;
  }
  error.value = null; working.value = true;
  const popup = window.open("about:blank", "jmmp-spotify-oauth", "width=520,height=740");
  try {
    const customId = clientId.value.trim();
    const result = await api.post<{ state: string; authUrl: string; manualCallback: boolean }>("/api/sources/spotify/oauth/start", {
      sourceName: name.value, ...(customId ? { clientId: customId } : {}),
    });
    state.value = result.state; authUrl.value = result.authUrl; manualCallback.value = result.manualCallback;
    if (popup) popup.location.href = result.authUrl;
    if (!result.manualCallback) poll = setInterval(() => void check(), 1500);
  } catch (e) { popup?.close(); error.value = e instanceof Error ? e.message : String(e); }
  finally { working.value = false; }
}
</script>
