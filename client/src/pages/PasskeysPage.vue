<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <div class="q-pa-lg">
    <div class="row items-center q-mb-md">
      <div class="text-h5">Passkeys</div>
      <q-space />
      <q-btn
        unelevated
        color="primary"
        icon="add"
        label="Add passkey"
        :loading="adding"
        @click="onAdd"
      />
    </div>

    <q-banner v-if="error" class="bg-red-1 text-red-10 q-mb-md" rounded dense>
      {{ error }}
    </q-banner>

    <q-card flat bordered>
      <q-list separator>
        <q-item v-for="p in passkeys" :key="p.id">
          <q-item-section>
            <q-item-label class="mono">{{ p.nickname || `Passkey #${p.id}` }}</q-item-label>
            <q-item-label caption>
              Added {{ formatTs(p.createdAt) }}
              · last used {{ p.lastUsedAt ? formatTs(p.lastUsedAt) : "never" }}
              <span v-if="p.transports.length"> · {{ p.transports.join(", ") }}</span>
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn
              flat
              dense
              icon="delete"
              color="negative"
              :disable="passkeys.length <= 1"
              @click="onDelete(p.id)"
            >
              <q-tooltip v-if="passkeys.length <= 1">
                Refusing to delete the last passkey. Run
                <code>jmmp wipe-passkeys</code> on the server instead.
              </q-tooltip>
            </q-btn>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>
    <PasskeyInvitations />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "src/api";
import { describeApiError, registerNewPasskey } from "src/auth";
import type { PasskeyListResponse, PasskeySummary } from "@jmmp/shared";
import PasskeyInvitations from "src/components/PasskeyInvitations.vue";

const passkeys = ref<PasskeySummary[]>([]);
const adding = ref(false);
const error = ref<string | null>(null);

onMounted(load);

async function load(): Promise<void> {
  try {
    const resp = await api.get<PasskeyListResponse>("/api/auth/passkeys");
    passkeys.value = resp.passkeys;
  } catch (err) {
    error.value = describeApiError(err);
  }
}

async function onAdd(): Promise<void> {
  error.value = null;
  adding.value = true;
  try {
    const nickname = window.prompt("Nickname for new passkey (optional):");
    await registerNewPasskey(nickname?.trim() || null);
    await load();
  } catch (err) {
    error.value = describeApiError(err);
  } finally {
    adding.value = false;
  }
}

async function onDelete(id: number): Promise<void> {
  if (!window.confirm("Delete this passkey?")) return;
  error.value = null;
  try {
    await api.del(`/api/auth/passkeys/${id}`);
    await load();
  } catch (err) {
    error.value = describeApiError(err);
  }
}

function formatTs(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}
</script>
