// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Database } from "bun:sqlite";
import { generateRegistrationOptions, type AuthenticatorTransport, type RegistrationResponseJSON, type verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AppCtx } from "./router.ts";
import type { PasskeyRole } from "@jmmp/shared";

type RegistrationInfo = NonNullable<Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"]>;

export function passkeyRegistrationOptions(ctx: AppCtx, userVerification: "preferred" | "required" = "preferred") {
  const passkeys = ctx.db.query<{ credential_id: Uint8Array; transports: string | null }, []>("SELECT credential_id,transports FROM passkeys").all();
  return generateRegistrationOptions({
    rpName: ctx.cfg.webauthn.rpName, rpID: ctx.cfg.webauthn.rpId,
    userID: new TextEncoder().encode("jmmp-user"), userName: "user", userDisplayName: "jmmp user",
    attestationType: "none", authenticatorSelection: { residentKey: "preferred", userVerification },
    excludeCredentials: passkeys.map(p => ({ id: Buffer.from(p.credential_id).toString("base64url"),
      transports: p.transports ? JSON.parse(p.transports) as AuthenticatorTransport[] : undefined })),
  });
}

/** Caller supplies transaction when registration consumes an invitation. */
export function insertRegisteredPasskey(db: Database, response: RegistrationResponseJSON, info: RegistrationInfo, nickname: string | null, role: PasskeyRole = "admin"): number {
  const result = db.run(`INSERT INTO passkeys (credential_id, public_key, counter, transports, nickname, aaguid, role) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    Buffer.from(info.credential.id, "base64url"), info.credential.publicKey, info.credential.counter,
    response.response.transports ? JSON.stringify(response.response.transports) : null, nickname,
    info.aaguid ? Buffer.from(info.aaguid.replaceAll("-", ""), "hex") : null,
    role,
  ]);
  return Number(result.lastInsertRowid);
}
