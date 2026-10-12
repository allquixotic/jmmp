<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <main class="invite-shell">
    <div class="invite-card">
      <div class="mono text-h4 q-mb-lg">jmmp</div>
      <h1 class="text-h6">Add your passkey</h1>
      <q-spinner v-if="loading" size="40px" />
      <template v-else-if="complete">
        <q-banner class="bg-green-1 text-green-10 q-mb-md" rounded>Passkey added. This invitation has been used and cannot be used again.</q-banner>
        <p>You can now sign in to jmmp with your passkey.</p>
        <q-btn color="primary" label="Open player" to="/" />
      </template>
      <template v-else>
        <template v-if="invitation">
          <p>This invitation grants <strong>{{ passkeyRoleLabel(invitation.role) }} access</strong> to jmmp. Add a passkey on your device to accept.</p>
          <p v-if="invitation.label">Invitation: {{ invitation.label }}</p>
          <p class="text-caption">Expires {{ new Date(invitation.expiresAt * 1000).toLocaleString() }}.</p>
          <q-input v-model="nickname" label="Passkey nickname (optional)" maxlength="120" :disable="working" class="q-mb-md" />
        </template>
        <q-banner v-if="error" class="bg-red-1 text-red-10 q-mb-md" rounded>{{ error }}</q-banner>
        <q-banner v-if="!supported && invitation" class="bg-amber-1 text-amber-10 q-mb-md" rounded>Open this invitation in a browser that supports passkeys.</q-banner>
        <q-btn v-if="invitation" color="primary" label="Add my passkey" :loading="working" :disable="!supported" @click="register" />
        <q-btn v-else flat label="Sign in" to="/login" />
      </template>
    </div>
  </main>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { passkeyRoleLabel, type PasskeyInvitationInfo } from "@jmmp/shared";
import { api, ApiError } from "src/api";
import { describeApiError, isWebAuthnSupported, registerInvitedPasskey } from "src/auth";
import { useSessionStore } from "src/stores/session";

const route = useRoute(), session = useSessionStore();
const token = new URLSearchParams(route.hash.slice(1)).get("token") ?? "";
const invitation = ref<PasskeyInvitationInfo | null>(null), nickname = ref("");
const error = ref<string | null>(null), loading = ref(true), working = ref(false), complete = ref(false);
const supported = isWebAuthnSupported();
onMounted(async () => {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("This invitation link is invalid. Ask for a new invitation.");
    invitation.value = await api.post<PasskeyInvitationInfo>("/api/auth/passkey/invitation/info", { token });
  } catch (err) { error.value = describeApiError(err); }
  finally { loading.value = false; }
});
async function register() {
  if (working.value) return;
  working.value = true; error.value = null;
  try {
    await registerInvitedPasskey(token, nickname.value.trim() || null);
    complete.value = true;
    // Registration already succeeded even if refreshing the session encounters
    // a temporary network error. The new passkey remains usable for sign-in.
    await session.refreshStatus().catch(() => {});
  } catch (err) {
    error.value = describeApiError(err);
    if (err instanceof ApiError && err.code === "bad_invitation") invitation.value = null;
  } finally { working.value = false; }
}
</script>
<style scoped>
.invite-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #0a0c10; color: #e6e8ee; }
.invite-card { width: min(480px, 95vw); padding: 32px; border-radius: 14px; background: #16191f; border: 1px solid #343740; }
</style>
