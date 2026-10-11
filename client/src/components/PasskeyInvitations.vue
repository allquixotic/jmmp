<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <section class="q-mt-xl">
    <h2 class="text-h6">Invite another person</h2>
    <p>Share a single-use link or QR code so someone can add their own passkey without signing in first.
      Their passkey gives full control of this jmmp instance.</p>
    <q-banner v-if="error" class="bg-red-1 text-red-10 q-mb-md" rounded dense>{{ error }}</q-banner>
    <div class="row q-col-gutter-md items-end">
      <q-input v-model="label" class="col-12 col-sm" label="Invitation label (optional)" maxlength="120" :disable="working" />
      <q-select v-model="lifetime" class="col-12 col-sm" label="Invitation expires after" :options="lifetimes" emit-value map-options :disable="working" />
      <div class="col-12 col-sm-auto">
        <q-btn color="primary" icon="person_add" label="Create invitation" :loading="working" @click="create" />
      </div>
    </div>
    <q-list v-if="invitations.length" bordered separator class="q-mt-lg">
      <q-item v-for="invitation in invitations" :key="invitation.id">
        <q-item-section>
          <q-item-label>{{ invitation.label || `Invitation #${invitation.id}` }}</q-item-label>
          <q-item-label caption>{{ status(invitation) }} · expires {{ formatTs(invitation.expiresAt) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn v-if="status(invitation) === 'Available'" flat color="negative" label="Revoke"
            :aria-label="`Revoke invitation ${invitation.label || invitation.id}`" :disable="working" @click="revoke(invitation.id)" />
        </q-item-section>
      </q-item>
    </q-list>
    <p v-else-if="!loading" class="text-caption q-mt-md">No invitations created yet.</p>

    <q-dialog v-model="showShare">
      <q-card class="invitation-share">
        <q-card-section>
          <div class="text-h6">Passkey invitation</div>
          <p class="q-mt-sm">Anyone with this link can add one passkey and gain full control of jmmp.
            The invitation stops working after successful registration.</p>
          <p v-if="created">Expires {{ formatTs(created.invitation.expiresAt) }}.</p>
          <q-input v-if="created" :model-value="created.url" label="Invitation link" readonly autogrow type="textarea" />
          <q-btn flat icon="content_copy" label="Copy invitation link" class="q-mt-sm" @click="copy" />
          <div class="qr-container q-mt-md">
            <img v-if="qr" :src="qr" alt="Passkey invitation QR code" width="300" height="300" />
            <q-spinner v-else-if="!qrError" size="40px" />
          </div>
          <p v-if="qrError" class="text-negative">Could not generate the QR code. You can still copy the link.</p>
          <q-btn v-if="qr" flat icon="download" label="Download QR code" :href="qr" download="jmmp-passkey-invitation.png" />
          <p class="text-caption q-mt-md">Copy or download this invitation before closing. Its link is shown only once.</p>
        </q-card-section>
        <q-card-actions align="right"><q-btn flat label="Done" v-close-popup /></q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { copyToClipboard, useQuasar } from "quasar";
import QRCode from "qrcode";
import type { CreatePasskeyInvitationResponse, PasskeyInvitation, PasskeyInvitationListResponse } from "@jmmp/shared";
import { api } from "src/api";
import { describeApiError } from "src/auth";

const $q = useQuasar();
const invitations = ref<PasskeyInvitation[]>([]), label = ref(""), lifetime = ref(86400);
const error = ref<string | null>(null), loading = ref(true), working = ref(false);
const created = ref<CreatePasskeyInvitationResponse | null>(null), showShare = ref(false), qr = ref(""), qrError = ref(false);
const now = ref(Date.now());
const lifetimes = [{ label: "1 hour", value: 3600 }, { label: "24 hours", value: 86400 }, { label: "7 days", value: 604800 }];
const timer = setInterval(() => { now.value = Date.now(); }, 30000);
onBeforeUnmount(() => clearInterval(timer));
onMounted(load);
async function load() {
  loading.value = true;
  try { invitations.value = (await api.get<PasskeyInvitationListResponse>("/api/auth/passkey/invitations")).invitations; }
  catch (err) { error.value = describeApiError(err); }
  finally { loading.value = false; }
}
async function create() {
  if (working.value) return;
  working.value = true; error.value = null; qr.value = ""; qrError.value = false;
  try {
    created.value = await api.post<CreatePasskeyInvitationResponse>("/api/auth/passkey/invitations", { label: label.value.trim() || null, expiresInSeconds: lifetime.value });
    showShare.value = true;
    try { qr.value = await QRCode.toDataURL(created.value.url, { errorCorrectionLevel: "M", margin: 4, width: 300 }); }
    catch { qrError.value = true; }
    await load();
  } catch (err) { error.value = describeApiError(err); }
  finally { working.value = false; }
}
async function copy() {
  if (!created.value) return;
  try { await copyToClipboard(created.value.url); $q.notify({ type: "positive", message: "Invitation link copied" }); }
  catch { $q.notify({ type: "negative", message: "Could not copy; select and copy the invitation link manually" }); }
}
async function revoke(id: number) {
  working.value = true; error.value = null;
  try { await api.del(`/api/auth/passkey/invitations/${id}`); await load(); }
  catch (err) { error.value = describeApiError(err); }
  finally { working.value = false; }
}
function status(invitation: PasskeyInvitation): string {
  if (invitation.consumedAt !== null) return "Used";
  if (invitation.revokedAt !== null) return "Revoked";
  return invitation.expiresAt * 1000 <= now.value ? "Expired" : "Available";
}
function formatTs(seconds: number): string { return new Date(seconds * 1000).toLocaleString(); }
</script>
<style scoped>
.invitation-share { width: 540px; max-width: 95vw; }
.qr-container { display: flex; justify-content: center; }
.qr-container img { max-width: 100%; height: auto; background: white; }
</style>
