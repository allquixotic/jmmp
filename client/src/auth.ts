// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api, ApiError } from "src/api";

export async function redeemBootstrapToken(token: string): Promise<void> {
  await api.post<{ deviceId: string }>("/api/auth/bootstrap-redeem", { token });
}

export async function registerNewPasskey(nickname: string | null): Promise<void> {
  const options = await api.get<PublicKeyCredentialCreationOptionsJSON>(
    "/api/auth/passkey/register/options"
  );
  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON: options });
  } catch (err) {
    if (err instanceof Error && err.name === "InvalidStateError") {
      throw new Error("This authenticator is already registered.");
    }
    throw err;
  }
  await api.post<{ verified: true }>("/api/auth/passkey/register/verify", {
    response: attestation,
    nickname,
  });
}

export async function registerInvitedPasskey(token: string, nickname: string | null): Promise<void> {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>("/api/auth/passkey/invitation/options", { token });
  let response;
  try { response = await startRegistration({ optionsJSON: options }); }
  catch (err) {
    if (err instanceof Error && err.name === "InvalidStateError") throw new Error("This authenticator is already registered. Use another passkey.");
    throw err;
  }
  await api.post<{ verified: true }>("/api/auth/passkey/invitation/verify", { token, response, nickname });
}

export async function signInWithPasskey(): Promise<void> {
  const options = await api.get<PublicKeyCredentialRequestOptionsJSON>(
    "/api/auth/passkey/auth/options"
  );
  const assertion = await startAuthentication({ optionsJSON: options });
  await api.post<{ verified: true }>("/api/auth/passkey/auth/verify", {
    response: assertion,
  });
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "bad_token") return "Invalid or already-used token.";
    if (err.code === "no_passkeys") return "No passkeys registered yet.";
    if (err.code === "bootstrapped") return "Bootstrap has already been completed.";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
