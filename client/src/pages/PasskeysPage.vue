<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page v-if="session.isAdmin">
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
            <q-btn flat dense icon="edit" :aria-label="`Rename ${p.nickname || `Passkey #${p.id}`}`" @click="onRename(p)"><q-tooltip>Rename</q-tooltip></q-btn>
          </q-item-section>
          <q-item-section side>
            <q-select :model-value="p.role" :options="roles" emit-value map-options dense outlined label="Role" style="min-width: 120px" :aria-label="`Role for ${p.nickname || `Passkey #${p.id}`}`" @update:model-value="role => onRole(p, role)" />
          </q-item-section>
          <q-item-section side>
            <q-btn
              flat
              dense
              icon="delete"
              color="negative"
              :disable="isLastAdmin(p) || passkeys.length <= 1"
              @click="onDelete(p.id)"
            >
              <q-tooltip v-if="isLastAdmin(p) || passkeys.length <= 1">
                Keep at least one admin passkey. Register another admin before removing this one.
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
import { onMounted, ref, watch } from "vue";
import { api } from "src/api";
import { describeApiError, registerNewPasskey } from "src/auth";
import type { PasskeyListResponse, PasskeySummary } from "@jmmp/shared";
import PasskeyInvitations from "src/components/PasskeyInvitations.vue";

import { PASSKEY_ROLES, isPasskeyRole, passkeyRoleLabel } from "@jmmp/shared";
import { useSessionStore } from "src/stores/session";
import { useRouter } from "vue-router";
const session = useSessionStore(), router = useRouter();
const roles = PASSKEY_ROLES.map(value => ({ value, label: passkeyRoleLabel(value) }));
function isLastAdmin(p: PasskeySummary): boolean { return p.role === "admin" && passkeys.value.filter(k => k.role === "admin").length === 1; }
async function onRename(p: PasskeySummary): Promise<void> {
  const nickname = window.prompt("Passkey label:", p.nickname ?? "");
  if (nickname === null) return;
  error.value = null;
  try { await api.patch(`/api/auth/passkeys/${p.id}`, { nickname }); await load(); }
  catch (err) { error.value = describeApiError(err); }
}
async function onRole(p: PasskeySummary, role: unknown): Promise<void> {
  if (!isPasskeyRole(role) || role === p.role) return;
  error.value = null;
  try {
    await api.patch(`/api/auth/passkeys/${p.id}`, { role }); await session.refreshStatus();
    if (!session.isAdmin) await router.push({ name: "home" }); else await load();
  } catch (err) { error.value = describeApiError(err); }
}
const passkeys = ref<PasskeySummary[]>([]);
const adding = ref(false);
const error = ref<string | null>(null);

onMounted(load);
watch(() => session.isAdmin, admin => { if (!admin) void router.replace({ name: "home" }); });

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
