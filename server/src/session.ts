// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Database } from "bun:sqlite";
import type { AppCtx, Req } from "./router.ts";
import { fail } from "./router.ts";
import { issueSession, readCookie, sessionCookie, verifySession } from "./jwt.ts";
import type { SessionScope } from "./jwt.ts";
import { isPasskeyRole, type PasskeyRole } from "@jmmp/shared";

export const SESSION_COOKIE = "jmmp_session";

export interface ActiveSession {
  did: string;
  scope: SessionScope;
  jti: string;
  role: PasskeyRole | null;
  passkeyId: number | null;
}

export async function readSession(req: Req): Promise<ActiveSession | null> {
  const token = readCookie(req.request, SESSION_COOKIE);
  if (!token) return null;
  const claims = await verifySession(req.ctx.cfg.jwtSecret, token);
  if (!claims) return null;
  const row = req.ctx.db
    .query<
      { jwt_jti: string; passkey_id: number | null; role: unknown },
      [string]
    >("SELECT d.jwt_jti,d.passkey_id,p.role FROM session_devices d LEFT JOIN passkeys p ON p.id=d.passkey_id WHERE d.id = ?")
    .get(claims.did);
  if (!row || row.jwt_jti !== claims.jti) return null;
  if (claims.scope === "full" && (!row.passkey_id || !isPasskeyRole(row.role))) return null;
  return { ...claims, role: isPasskeyRole(row.role) ? row.role : null, passkeyId: row.passkey_id };
}

export async function requireFullSession(req: Req): Promise<ActiveSession | Response> {
  const s = await readSession(req);
  if (!s) return fail("unauthenticated", 401, "no_session");
  if (s.scope !== "full") return fail("registration session only", 403, "scope");
  return s;
}

export async function requireRegOrFullSession(
  req: Req
): Promise<ActiveSession | Response> {
  const s = await readSession(req);
  if (!s) return fail("unauthenticated", 401, "no_session");
  if (s.scope === "full" && s.role !== "admin") return fail("Administrator role required", 403, "role");
  if (s.scope === "registration" && req.ctx.db.query("SELECT 1 FROM passkeys LIMIT 1").get()) {
    return fail("Bootstrap registration has finished", 403, "scope");
  }
  return s;
}

export async function requireAdminSession(req: Req): Promise<ActiveSession | Response> {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  return session.role === "admin" ? session : fail("Administrator role required", 403, "role");
}

export async function mintSession(
  ctx: AppCtx,
  did: string,
  scope: SessionScope,
  passkeyId?: number
): Promise<{ token: string; cookie: string; jti: string }> {
  if (scope === "full" && (!passkeyId || !ctx.db.query("SELECT id FROM passkeys WHERE id=?").get(passkeyId))) {
    throw new Error("Full sessions require an authenticated passkey");
  }
  const ttlSec =
    scope === "registration" ? 600 : ctx.cfg.sessionTtlDays * 86400;
  const token = await issueSession(ctx.cfg.jwtSecret, did, scope, ttlSec);
  const claims = await verifySession(ctx.cfg.jwtSecret, token);
  const jti = claims!.jti;
  upsertDevice(ctx.db, did, jti, passkeyId ?? null);
  const secure = isSecureOrigin(ctx);
  const cookie = sessionCookie(SESSION_COOKIE, token, ttlSec, secure);
  return { token, cookie, jti };
}

function upsertDevice(db: Database, did: string, jti: string, passkeyId: number | null): void {
  db.run(
    `INSERT INTO session_devices (id, jwt_jti, passkey_id) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET jwt_jti = excluded.jwt_jti, passkey_id=excluded.passkey_id, last_heartbeat_at = unixepoch()`,
    [did, jti, passkeyId]
  );
}

export function isSecureOrigin(ctx: AppCtx): boolean {
  const origins = Array.isArray(ctx.cfg.webauthn.origin)
    ? ctx.cfg.webauthn.origin
    : [ctx.cfg.webauthn.origin];
  return origins.every((o) => o.startsWith("https://"));
}
