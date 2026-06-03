// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Database } from "bun:sqlite";
import type { AppCtx, Req } from "./router.ts";
import { fail, json } from "./router.ts";
import { issueSession, readCookie, sessionCookie, verifySession } from "./jwt.ts";
import type { SessionScope } from "./jwt.ts";

export const SESSION_COOKIE = "jmmp_session";

export interface ActiveSession {
  did: string;
  scope: SessionScope;
  jti: string;
}

export async function readSession(req: Req): Promise<ActiveSession | null> {
  const token = readCookie(req.request, SESSION_COOKIE);
  if (!token) return null;
  const claims = await verifySession(req.ctx.cfg.jwtSecret, token);
  if (!claims) return null;
  const row = req.ctx.db
    .query<
      { jwt_jti: string },
      [string]
    >("SELECT jwt_jti FROM session_devices WHERE id = ?")
    .get(claims.did);
  if (!row || row.jwt_jti !== claims.jti) return null;
  return claims;
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
  return s;
}

export async function mintSession(
  ctx: AppCtx,
  did: string,
  scope: SessionScope
): Promise<{ token: string; cookie: string; jti: string }> {
  const ttlSec =
    scope === "registration" ? 600 : ctx.cfg.sessionTtlDays * 86400;
  const token = await issueSession(ctx.cfg.jwtSecret, did, scope, ttlSec);
  const claims = await verifySession(ctx.cfg.jwtSecret, token);
  const jti = claims!.jti;
  upsertDevice(ctx.db, did, jti);
  const secure = isSecureOrigin(ctx);
  const cookie = sessionCookie(SESSION_COOKIE, token, ttlSec, secure);
  return { token, cookie, jti };
}

function upsertDevice(db: Database, did: string, jti: string): void {
  db.run(
    `INSERT INTO session_devices (id, jwt_jti) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET jwt_jti = excluded.jwt_jti, last_heartbeat_at = unixepoch()`,
    [did, jti]
  );
}

export function isSecureOrigin(ctx: AppCtx): boolean {
  const origins = Array.isArray(ctx.cfg.webauthn.origin)
    ? ctx.cfg.webauthn.origin
    : [ctx.cfg.webauthn.origin];
  return origins.every((o) => o.startsWith("https://"));
}
