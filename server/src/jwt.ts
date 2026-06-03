// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { SignJWT, jwtVerify } from "jose";

export type SessionScope = "registration" | "full";

export interface SessionClaims {
  jti: string;
  did: string;
  scope: SessionScope;
}

const REG_TTL_SEC = 600;

let secretCache: Uint8Array | null = null;

function secret(rawSecret: string): Uint8Array {
  if (secretCache) return secretCache;
  secretCache = new TextEncoder().encode(rawSecret);
  return secretCache;
}

export async function issueSession(
  rawSecret: string,
  did: string,
  scope: SessionScope,
  fullTtlSec: number
): Promise<string> {
  const jti = crypto.randomUUID();
  const ttl = scope === "registration" ? REG_TTL_SEC : fullTtlSec;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ did, scope })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setJti(jti)
    .sign(secret(rawSecret));
}

export async function verifySession(
  rawSecret: string,
  token: string
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(rawSecret), {
      algorithms: ["HS256"],
    });
    if (!payload.jti) return null;
    return {
      jti: payload.jti,
      did: String(payload["did"] ?? ""),
      scope: payload["scope"] === "registration" ? "registration" : "full",
    };
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function sessionCookie(
  name: string,
  value: string,
  maxAgeSec: number,
  secure: boolean
): string {
  const attrs = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return sessionCookie(name, "", 0, secure);
}
