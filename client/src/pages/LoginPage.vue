<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="login-shell">
    <div class="login-card">
      <div class="login-brand mono">jmmp</div>

      <template v-if="!session.statusLoaded">
        <q-spinner size="40px" />
      </template>

      <template v-else-if="!session.hasPasskeys && session.hasBootstrapToken">
        <div class="login-section-title">First-time setup</div>
        <p class="login-section-desc">
          Enter the bootstrap token printed by the server, then register a passkey
          on this device.
        </p>
        <q-input
          v-model="token"
          dense
          borderless
          autofocus
          placeholder="Bootstrap token"
          aria-label="Bootstrap token"
          class="login-input mono"
          autocomplete="off"
          :disable="working"
        />
        <q-input
          v-model="nickname"
          dense
          borderless
          placeholder="Passkey nickname (optional)"
          aria-label="Passkey nickname"
          class="login-input"
          :disable="working"
        />
        <q-banner v-if="error" class="bg-red-1 text-red-10 q-mb-md" rounded dense>
          {{ error }}
        </q-banner>
        <q-btn
          unelevated
          color="primary"
          :loading="working"
          :disable="!token || !webauthnSupported"
          @click="onBootstrap"
        >
          Register passkey
        </q-btn>
      </template>

      <template v-else-if="session.hasPasskeys">
        <div class="login-section-title">Sign in</div>
        <p class="login-section-desc">Use your passkey to sign in.</p>
        <q-banner v-if="error" class="bg-red-1 text-red-10 q-mb-md" rounded dense>
          {{ error }}
        </q-banner>
        <q-btn
          unelevated
          color="primary"
          :loading="working"
          :disable="!webauthnSupported"
          @click="onSignIn"
        >
          Sign in with passkey
        </q-btn>
      </template>

      <template v-else>
        <q-banner class="bg-amber-1 text-amber-10" rounded>
          No passkeys and no bootstrap token. Run
          <code class="mono">jmmp wipe-passkeys</code>
          on the server to issue one.
        </q-banner>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useSessionStore } from "src/stores/session";
import {
  describeApiError,
  isWebAuthnSupported,
  redeemBootstrapToken,
  registerNewPasskey,
  signInWithPasskey,
} from "src/auth";

const router = useRouter();
const route = useRoute();
const session = useSessionStore();

const token = ref("");
const nickname = ref("");
const error = ref<string | null>(null);
const working = ref(false);
const webauthnSupported = isWebAuthnSupported();

onMounted(async () => {
  if (!session.statusLoaded) await session.refreshStatus();
  if (session.hasFullSession) await goNext();
});

async function goNext(): Promise<void> {
  const next = typeof route.query.next === "string" ? route.query.next : "/";
  await router.replace(next);
}

async function onBootstrap(): Promise<void> {
  error.value = null;
  working.value = true;
  try {
    await redeemBootstrapToken(token.value.trim());
    await registerNewPasskey(nickname.value.trim() || null);
    await session.refreshStatus();
    await goNext();
  } catch (err) {
    error.value = describeApiError(err);
  } finally {
    working.value = false;
  }
}

async function onSignIn(): Promise<void> {
  error.value = null;
  working.value = true;
  try {
    await signInWithPasskey();
    await session.refreshStatus();
    await goNext();
  } catch (err) {
    error.value = describeApiError(err);
  } finally {
    working.value = false;
  }
}
</script>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at top, rgba(80, 30, 60, 0.45), rgba(10, 12, 16, 0.95) 65%),
    #0a0c10;
  color: #e6e8ee;
}

.login-card {
  width: min(440px, 92vw);
  padding: 32px 28px;
  background: rgba(20, 22, 28, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  backdrop-filter: blur(20px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
}

.login-brand {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 18px;
}

.login-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #ff6b87;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.login-section-desc {
  font-size: 13px;
  color: #9aa0a8;
  margin: 0 0 16px;
}

.login-input {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
}

.login-input :deep(.q-field__control) {
  min-height: 32px;
  height: 32px;
}

.login-input :deep(input) {
  color: white;
  font-size: 13px;
}
</style>
