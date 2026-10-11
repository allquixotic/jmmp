// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import type { PasskeyInvitation } from "@jmmp/shared";
import { del, fail, get, ok, post, type Req } from "../router.ts";
import { sha256 } from "../crypto.ts";
import { mintSession, requireFullSession } from "../session.ts";
import { configuredRequestOrigin, originList } from "../origins.ts";
import { insertRegisteredPasskey, passkeyRegistrationOptions } from "../passkey-registration.ts";

const management = "/api/auth/passkey/invitations";
const enrollment = "/api/auth/passkey/invitation";
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const invalidMessage = "This invitation is invalid, expired, revoked, or already used. Ask for a new invitation.";
const invalid = () => error(invalidMessage, 410, "bad_invitation");
function error(message: string, status: number, code?: string): Response {
  const response = fail(message, status, code);
  for (const [name, value] of Object.entries(noStore)) response.headers.set(name, value);
  return response;
}
function allowedOrigin(req: Req): boolean {
  try { configuredRequestOrigin(req.request, req.ctx.cfg.webauthn.origin); return true; }
  catch { return false; }
}

// These public endpoints need a small body, unlike the audio upload API.
async function bodyOf(req: Req): Promise<Record<string, unknown> | Response> {
  const reader = req.request.body?.getReader();
  if (!reader) return error("Request required", 400);
  let bytes = 0, text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 65536) { await reader.cancel(); return error("Request too large", 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : error("Invalid request", 400);
  } catch { return error("Invalid request", 400); }
  finally { reader.releaseLock(); }
}

interface InvitationRow {
  id: number; label: string | null; created_at: number; expires_at: number;
  consumed_at: number | null; revoked_at: number | null;
}
const columns = "id,label,created_at,expires_at,consumed_at,revoked_at";
function invitationOf(row: InvitationRow): PasskeyInvitation {
  return { id: row.id, label: row.label, createdAt: row.created_at, expiresAt: row.expires_at, consumedAt: row.consumed_at, revokedAt: row.revoked_at };
}
async function activeInvitation(req: Req, token: unknown): Promise<InvitationRow | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return req.ctx.db.query<InvitationRow, [Uint8Array]>(`SELECT ${columns} FROM passkey_invitations
    WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>unixepoch()`).get(await sha256(token));
}

post(management, async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  if (!allowedOrigin(req)) return error("Use a configured jmmp origin", 403);
  const body = await bodyOf(req); if (body instanceof Response) return body;
  const expiresInSeconds = body.expiresInSeconds ?? 86400;
  if (typeof expiresInSeconds !== "number" || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 300 || expiresInSeconds > 604800)
    return error("Invitation lifetime must be between five minutes and seven days", 400);
  if (body.label !== undefined && body.label !== null && (typeof body.label !== "string" || body.label.length > 120)) return error("Invitation label must be at most 120 characters", 400);
  const label = typeof body.label === "string" ? body.label.trim() || null : null;
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"), hash = await sha256(token);
  const invitation = req.ctx.db.transaction(() => {
    const count = req.ctx.db.query<{ n: number }, []>("SELECT count(*) n FROM passkey_invitations WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at>unixepoch()").get()!.n;
    if (count >= 20) return null;
    const result = req.ctx.db.run("INSERT INTO passkey_invitations(token_hash,label,created_by,expires_at) VALUES (?,?,?,unixepoch()+?)", [hash, label, session.did, expiresInSeconds]);
    return req.ctx.db.query<InvitationRow, [number]>(`SELECT ${columns} FROM passkey_invitations WHERE id=?`).get(Number(result.lastInsertRowid))!;
  })();
  if (!invitation) return error("Revoke an existing invitation before creating more", 429);
  const url = new URL("/invite", configuredRequestOrigin(req.request, req.ctx.cfg.webauthn.origin));
  url.hash = new URLSearchParams({ token }).toString();
  return ok({ invitation: invitationOf(invitation), url: url.href }, { status: 201, headers: noStore });
});

get(management, async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  const rows = req.ctx.db.query<InvitationRow, []>(`SELECT ${columns} FROM passkey_invitations
    ORDER BY (consumed_at IS NULL AND revoked_at IS NULL AND expires_at>unixepoch()) DESC,id DESC LIMIT 100`).all();
  return ok({ invitations: rows.map(invitationOf) }, { headers: noStore });
});

del(management + "/:id", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  if (!allowedOrigin(req)) return error("Use a configured jmmp origin", 403);
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return error("Invalid invitation ID", 400);
  const changed = req.ctx.db.transaction(() => {
    const result = req.ctx.db.run("UPDATE passkey_invitations SET revoked_at=unixepoch() WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL", [id]);
    req.ctx.db.run("DELETE FROM passkey_invitation_challenges WHERE invitation_id=?", [id]);
    return result.changes;
  })();
  return changed ? ok({ revoked: id }, { headers: noStore }) : error("Invitation is unavailable", 404);
});

post(enrollment + "/info", async req => {
  if (!allowedOrigin(req)) return error("Use a configured jmmp origin", 403);
  const body = await bodyOf(req); if (body instanceof Response) return body;
  const invitation = await activeInvitation(req, body.token);
  return invitation ? ok({ label: invitation.label, expiresAt: invitation.expires_at }, { headers: noStore }) : invalid();
});

post(enrollment + "/options", async req => {
  if (!allowedOrigin(req)) return error("Use a configured jmmp origin", 403);
  const body = await bodyOf(req); if (body instanceof Response) return body;
  const invitation = await activeInvitation(req, body.token); if (!invitation) return invalid();
  const options = await passkeyRegistrationOptions(req.ctx, "required");
  const stored = req.ctx.db.transaction(() => {
    const current = req.ctx.db.query("SELECT id FROM passkey_invitations WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>unixepoch()").get(invitation.id);
    if (!current) return false;
    req.ctx.db.run("DELETE FROM passkey_invitation_challenges WHERE created_at<=unixepoch()-600");
    req.ctx.db.run("DELETE FROM passkey_invitation_challenges WHERE invitation_id=? AND challenge NOT IN (SELECT challenge FROM passkey_invitation_challenges WHERE invitation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 4)", [invitation.id, invitation.id]);
    req.ctx.db.run("INSERT INTO passkey_invitation_challenges(challenge,invitation_id) VALUES (?,?)", [options.challenge, invitation.id]);
    return true;
  })();
  return stored ? ok(options, { headers: noStore }) : invalid();
});

class InvitationUnavailable extends Error {}
class CredentialExists extends Error {}
post(enrollment + "/verify", async req => {
  if (!allowedOrigin(req)) return error("Use a configured jmmp origin", 403);
  const body = await bodyOf(req); if (body instanceof Response) return body;
  const invitation = await activeInvitation(req, body.token); if (!invitation) return invalid();
  if (body.nickname !== undefined && body.nickname !== null && (typeof body.nickname !== "string" || body.nickname.length > 120)) return error("Passkey nickname must be at most 120 characters", 400);
  const response = body.response as RegistrationResponseJSON | undefined;
  let challenge: unknown;
  try {
    if (!response || response.type !== "public-key" || typeof response.response.clientDataJSON !== "string") throw new Error();
    challenge = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString()).challenge;
  } catch { return error("Invalid passkey response", 400); }
  if (typeof challenge !== "string" || challenge.length > 1024) return error("Invalid passkey challenge", 400);
  const used = req.ctx.db.query<{ challenge: string }, [string, number]>("DELETE FROM passkey_invitation_challenges WHERE challenge=? AND invitation_id=? AND created_at>unixepoch()-600 RETURNING challenge").get(challenge, invitation.id);
  if (!used) return error("Registration expired; try adding your passkey again", 400, "bad_challenge");
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge,
      expectedOrigin: originList(req.ctx.cfg.webauthn.origin), expectedRPID: req.ctx.cfg.webauthn.rpId, requireUserVerification: true });
  } catch { return error("Passkey verification failed; try again", 400); }
  if (!verification.verified || !verification.registrationInfo) return error("Passkey verification failed; try again", 400);
  const info = verification.registrationInfo;
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() || invitation.label : invitation.label;
  try {
    req.ctx.db.transaction(() => {
      const used = req.ctx.db.run("UPDATE passkey_invitations SET consumed_at=unixepoch() WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>unixepoch()", [invitation.id]);
      if (!used.changes) throw new InvitationUnavailable();
      if (req.ctx.db.query("SELECT id FROM passkeys WHERE credential_id=?").get(Buffer.from(info.credential.id, "base64url"))) throw new CredentialExists();
      insertRegisteredPasskey(req.ctx.db, response, info, nickname);
      req.ctx.db.run("DELETE FROM passkey_invitation_challenges WHERE invitation_id=?", [invitation.id]);
    })();
  } catch (err) {
    if (err instanceof InvitationUnavailable) return invalid();
    if (err instanceof CredentialExists) return error("This authenticator is already registered; use another passkey", 409);
    return error("Could not save your passkey; try again", 500);
  }
  const { cookie } = await mintSession(req.ctx, crypto.randomUUID(), "full");
  return ok({ verified: true }, { headers: { ...noStore, "Set-Cookie": cookie } });
});
