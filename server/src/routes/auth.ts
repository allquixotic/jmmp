// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Database } from "bun:sqlite";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransport,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import type { AuthStatusResponse, PasskeyListResponse } from "@jmmp/shared";
import { fail, get, ok, post, readJson, type Req } from "../router.ts";
import {
  bytesEqual,
  generateBootstrapToken,
  sha256,
} from "../crypto.ts";
import {
  SESSION_COOKIE,
  isSecureOrigin,
  mintSession,
  readSession,
  requireFullSession,
  requireRegOrFullSession,
} from "../session.ts";
import { clearCookie } from "../jwt.ts";
import { log } from "../log.ts";

const RP_USER_ID = "jmmp-user";
let lastDebugBootstrapToken: string | null = null;

interface PasskeyRow {
  id: number;
  credential_id: Uint8Array;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  nickname: string | null;
  aaguid: Uint8Array | null;
  created_at: number;
  last_used_at: number | null;
}

function listPasskeys(db: Database): PasskeyRow[] {
  return db
    .query<PasskeyRow, []>(`SELECT * FROM passkeys ORDER BY created_at`)
    .all();
}

function passkeyCount(db: Database): number {
  return (
    db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM passkeys").get()?.c ??
    0
  );
}

function activeBootstrap(db: Database) {
  return db
    .query<
      { id: number },
      []
    >("SELECT id FROM bootstrap_tokens WHERE consumed_at IS NULL LIMIT 1")
    .get();
}

export async function ensureBootstrapTokenIfNeeded(db: Database): Promise<string | null> {
  if (passkeyCount(db) > 0) return null;
  if (activeBootstrap(db)) return null;
  const token = generateBootstrapToken();
  const hash = await sha256(token);
  db.run("INSERT INTO bootstrap_tokens (token_hash) VALUES (?)", [hash]);
  if (process.env.JMMP_E2E_DEBUG === "1") lastDebugBootstrapToken = token;
  return token;
}

export async function printBootstrapTokenIfNeeded(db: Database): Promise<void> {
  if (passkeyCount(db) > 0) return;
  const token = await ensureBootstrapTokenIfNeeded(db);
  if (!token) {
    log.warn(
      "no passkeys registered, but an unconsumed bootstrap token exists; " +
        "run `jmmp wipe-passkeys` to issue a fresh one"
    );
    return;
  }
  printBanner(token);
}

function printBanner(token: string): void {
  const bar = "═".repeat(64);
  console.log(`\n${bar}\n  Bootstrap token (single use):\n\n      ${token}\n\n  Enter this in the jmmp web UI to register your first passkey.\n${bar}\n`);
}

function storeChallenge(db: Database, challenge: string, kind: "registration" | "authentication"): void {
  db.run("DELETE FROM webauthn_challenges WHERE created_at < unixepoch() - 600");
  db.run("INSERT INTO webauthn_challenges (challenge, kind) VALUES (?, ?)", [
    challenge,
    kind,
  ]);
}

function consumeChallenge(
  db: Database,
  challenge: string,
  kind: "registration" | "authentication"
): boolean {
  const row = db
    .query<
      { id: number },
      [string, string]
    >("SELECT id FROM webauthn_challenges WHERE challenge = ? AND kind = ?")
    .get(challenge, kind);
  if (!row) return false;
  db.run("DELETE FROM webauthn_challenges WHERE id = ?", [row.id]);
  return true;
}

function rpOrigins(req: Req): string[] {
  const o = req.ctx.cfg.webauthn.origin;
  return Array.isArray(o) ? o : [o];
}

get("/api/auth/status", async (req: Req) => {
  const session = await readSession(req);
  const body: AuthStatusResponse = {
    hasPasskeys: passkeyCount(req.ctx.db) > 0,
    hasBootstrapToken: !!activeBootstrap(req.ctx.db),
    hasFullSession: session?.scope === "full",
    hasRegistrationSession: session?.scope === "registration",
  };
  return ok(body);
});

get("/api/auth/_debug/bootstrap-token", async () => {
  if (process.env.JMMP_E2E_DEBUG !== "1") return fail("not found", 404);
  if (!lastDebugBootstrapToken) return fail("no debug token", 404);
  return ok({ token: lastDebugBootstrapToken });
});

post("/api/auth/bootstrap-redeem", async (req: Req) => {
  if (passkeyCount(req.ctx.db) > 0) {
    return fail("already bootstrapped", 409, "bootstrapped");
  }
  const body = await readJson<{ token?: string }>(req);
  if (!body.token) return fail("token required", 400, "missing_token");
  const hash = await sha256(body.token.trim().toUpperCase());
  const rows = req.ctx.db
    .query<
      { id: number; token_hash: Uint8Array },
      []
    >("SELECT id, token_hash FROM bootstrap_tokens WHERE consumed_at IS NULL")
    .all();
  const match = rows.find((r) => bytesEqual(r.token_hash, hash));
  if (!match) return fail("invalid or used token", 401, "bad_token");
  req.ctx.db.run("UPDATE bootstrap_tokens SET consumed_at = unixepoch() WHERE id = ?", [
    match.id,
  ]);
  const did = crypto.randomUUID();
  const { cookie } = await mintSession(req.ctx, did, "registration");
  return ok({ deviceId: did }, { headers: { "Set-Cookie": cookie } });
});

get("/api/auth/passkey/register/options", async (req: Req) => {
  const session = await requireRegOrFullSession(req);
  if (session instanceof Response) return session;
  const passkeys = listPasskeys(req.ctx.db);
  const opts = await generateRegistrationOptions({
    rpName: req.ctx.cfg.webauthn.rpName,
    rpID: req.ctx.cfg.webauthn.rpId,
    userID: new TextEncoder().encode(RP_USER_ID),
    userName: "user",
    userDisplayName: "jmmp user",
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: passkeys.map((p) => ({
      id: bytesToBase64Url(p.credential_id),
      transports: (p.transports
        ? (JSON.parse(p.transports) as AuthenticatorTransport[])
        : undefined),
    })),
  });
  storeChallenge(req.ctx.db, opts.challenge, "registration");
  return ok(opts);
});

post("/api/auth/passkey/register/verify", async (req: Req) => {
  const session = await requireRegOrFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<{ response: RegistrationResponseJSON; nickname?: string }>(
    req
  );
  if (!body.response) return fail("response required", 400, "missing_response");

  const clientData = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(body.response.response.clientDataJSON))
  );
  const challenge = clientData.challenge as string;
  if (!consumeChallenge(req.ctx.db, challenge, "registration")) {
    return fail("unknown challenge", 400, "bad_challenge");
  }

  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: rpOrigins(req),
    expectedRPID: req.ctx.cfg.webauthn.rpId,
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return fail("verification failed", 400, "verify");
  }
  const info = verification.registrationInfo;
  const credentialId = base64UrlToBytes(info.credential.id);
  const publicKey = info.credential.publicKey;
  const counter = info.credential.counter;
  const aaguid = info.aaguid ? hexToBytes(info.aaguid.replaceAll("-", "")) : null;
  const transports = body.response.response.transports
    ? JSON.stringify(body.response.response.transports)
    : null;

  req.ctx.db.run(
    `INSERT INTO passkeys (credential_id, public_key, counter, transports, nickname, aaguid)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      credentialId,
      publicKey,
      counter,
      transports,
      body.nickname ?? null,
      aaguid,
    ]
  );

  req.ctx.db.run(
    "DELETE FROM bootstrap_tokens WHERE consumed_at IS NOT NULL"
  );

  const { cookie } = await mintSession(req.ctx, session.did, "full");
  return ok({ verified: true }, { headers: { "Set-Cookie": cookie } });
});

get("/api/auth/passkey/auth/options", async (req: Req) => {
  const passkeys = listPasskeys(req.ctx.db);
  if (passkeys.length === 0) {
    return fail("no passkeys registered", 409, "no_passkeys");
  }
  const opts = await generateAuthenticationOptions({
    rpID: req.ctx.cfg.webauthn.rpId,
    allowCredentials: passkeys.map((p) => ({
      id: bytesToBase64Url(p.credential_id),
      transports: (p.transports
        ? (JSON.parse(p.transports) as AuthenticatorTransport[])
        : undefined),
    })),
    userVerification: "preferred",
  });
  storeChallenge(req.ctx.db, opts.challenge, "authentication");
  return ok(opts);
});

post("/api/auth/passkey/auth/verify", async (req: Req) => {
  const body = await readJson<{ response: AuthenticationResponseJSON }>(req);
  if (!body.response) return fail("response required", 400, "missing_response");

  const clientData = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(body.response.response.clientDataJSON))
  );
  const challenge = clientData.challenge as string;
  if (!consumeChallenge(req.ctx.db, challenge, "authentication")) {
    return fail("unknown challenge", 400, "bad_challenge");
  }

  const credIdBytes = base64UrlToBytes(body.response.id);
  const passkey = req.ctx.db
    .query<PasskeyRow, [Uint8Array]>("SELECT * FROM passkeys WHERE credential_id = ?")
    .get(credIdBytes);
  if (!passkey) return fail("unknown credential", 401, "bad_cred");

  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: rpOrigins(req),
    expectedRPID: req.ctx.cfg.webauthn.rpId,
    credential: {
      id: bytesToBase64Url(passkey.credential_id),
      publicKey: new Uint8Array(passkey.public_key),
      counter: passkey.counter,
      transports: passkey.transports
        ? (JSON.parse(passkey.transports) as AuthenticatorTransport[])
        : undefined,
    },
    requireUserVerification: false,
  });
  if (!verification.verified) {
    return fail("verification failed", 401, "verify");
  }
  req.ctx.db.run(
    "UPDATE passkeys SET counter = ?, last_used_at = unixepoch() WHERE id = ?",
    [verification.authenticationInfo.newCounter, passkey.id]
  );

  const did = crypto.randomUUID();
  const { cookie } = await mintSession(req.ctx, did, "full");
  return ok({ verified: true }, { headers: { "Set-Cookie": cookie } });
});

get("/api/auth/passkeys", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const rows = listPasskeys(req.ctx.db);
  const body: PasskeyListResponse = {
    passkeys: rows.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      transports: p.transports ? (JSON.parse(p.transports) as string[]) : [],
      lastUsedAt: p.last_used_at,
      createdAt: p.created_at,
    })),
  };
  return ok(body);
});

import { del } from "../router.ts";

del("/api/auth/passkeys/:id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) return fail("bad id", 400);
  const count = passkeyCount(req.ctx.db);
  if (count <= 1) {
    return fail(
      "refuse to delete the last passkey; use `jmmp wipe-passkeys` on the server",
      409,
      "last_passkey"
    );
  }
  req.ctx.db.run("DELETE FROM passkeys WHERE id = ?", [id]);
  return ok({ deleted: id });
});

post("/api/auth/logout", async (req: Req) => {
  const session = await readSession(req);
  if (session) {
    req.ctx.db.run("DELETE FROM session_devices WHERE id = ?", [session.did]);
  }
  const cookie = clearCookie(SESSION_COOKIE, isSecureOrigin(req.ctx));
  return ok({}, { headers: { "Set-Cookie": cookie } });
});

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
