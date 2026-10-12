// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as webauthn from "@simplewebauthn/server";
import { initDb } from "../db.ts";
import { loadOrInitMachineKey, sha256 } from "../crypto.ts";
import { mintTestSession as mintSession } from "./session-fixture.ts";
import { dispatch, type AppCtx } from "../router.ts";
import { PASSKEY_ROLES, type PasskeyRole, type CreatePasskeyInvitationResponse } from "@jmmp/shared";
import "../routes/index.ts";
import roleMigration from "../migrations/0011_invitation_roles.sql" with { type: "text" };

const base = "/api/auth/passkey/invitations";
const publicBase = "/api/auth/passkey/invitation";
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jmmp-invite-")), db = initDb(dir);
  const ctx = { cfg: { dataDir: dir, jwtSecret: "test", sessionTtlDays: 1,
    webauthn: { rpId: "control.example.com", rpName: "jmmp test", origin: "https://control.example.com" } },
    db, machineKey: await loadOrInitMachineKey(dir) } as AppCtx;
  const owner = await mintSession(ctx, "owner", "full");
  const registration = await mintSession(ctx, "bootstrap", "registration");
  const call = (path: string, body?: unknown, cookie = "", method = body ? "POST" : "GET", origin = "https://control.example.com") => dispatch(new Request(origin + path, {
    method, headers: { cookie, "X-jmmp-Client": "1", origin }, body: body ? JSON.stringify(body) : undefined,
  }), ctx);
  async function invite(role?: PasskeyRole) {
    const response = await call(base, { label: "Friend", expiresInSeconds: 86400, ...(role === undefined ? {} : { role }) }, owner.cookie);
    expect(response.status).toBe(201);
    const { data } = await response.json() as { data: CreatePasskeyInvitationResponse };
    const url = new URL(data.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("token")!;
    return { ...data, token };
  }
  async function options(token: string) {
    const response = await call(publicBase + "/options", { token });
    expect(response.status).toBe(200);
    return (await response.json() as { data: { challenge: string } }).data;
  }
  const attestation = (challenge: string) => ({ id: "ZmFrZQ", rawId: "ZmFrZQ", type: "public-key",
    response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge, origin: "https://control.example.com", type: "webauthn.create" })).toString("base64url"), attestationObject: "fake", transports: ["internal"] }, clientExtensionResults: {} });
  return { dir, db, ctx, owner, registration, call, invite, options, attestation, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function successfulVerification(id: string): Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>> {
  return { verified: true, registrationInfo: { credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
    aaguid: "00000000-0000-0000-0000-000000000000", fmt: "none", credentialType: "public-key", attestationObject: new Uint8Array(),
    userVerified: true, credentialDeviceType: "singleDevice", credentialBackedUp: false, origin: "https://control.example.com", rpID: "control.example.com" } };
}

test("V21 invitations require a full session, persist only a hash and never list the secret", async () => {
  const f = await fixture();
  try {
    expect((await f.call(base, {})).status).toBe(401);
    expect((await f.call(base, {}, f.registration.cookie)).status).toBe(403);
    expect((await f.call(base)).status).toBe(401);
    const invitation = await f.invite();
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new URL(invitation.url).origin).toBe("https://control.example.com");
    expect(new URL(invitation.url).search).toBe("");
    const row = f.db.query<{ token_hash: Uint8Array }, [number]>("SELECT token_hash FROM passkey_invitations WHERE id=?").get(invitation.invitation.id)!;
    expect(row.token_hash).toEqual(await sha256(invitation.token));
    const listed = await f.call(base, undefined, f.owner.cookie);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(await listed.text()).not.toContain(invitation.token);
    expect((await f.call(base + "/" + invitation.invitation.id, undefined, "", "DELETE")).status).toBe(401);
    for (const expiresInSeconds of [0, -1, 299, 604801, "86400"])
      expect((await f.call(base, { expiresInSeconds }, f.owner.cookie)).status).toBe(400);
    expect((await f.call(base, {}, f.owner.cookie, "POST", "https://evil.example")).status).toBe(403);
  } finally { f.close(); }
});

test("V22 previews and failed registration keep invitations usable without granting a session", async () => {
  const f = await fixture();
  const verify = spyOn(webauthn, "verifyRegistrationResponse").mockResolvedValue({ verified: false });
  try {
    const invitation = await f.invite();
    const info = await f.call(publicBase + "/info", { token: invitation.token });
    expect(info.status).toBe(200); expect(info.headers.get("set-cookie")).toBeNull();
    const first = await f.options(invitation.token);
    expect((await f.call(publicBase + "/verify", { token: invitation.token, response: f.attestation(first.challenge) })).status).toBe(400);
    expect((await f.call(publicBase + "/info", { token: invitation.token })).status).toBe(200);
    await f.options(invitation.token);
    expect(f.db.query("SELECT 1 FROM passkeys WHERE nickname IS NOT '__test__'").get()).toBeNull();
    expect((await f.call("/api/playlists")).status).toBe(401);
  } finally { verify.mockRestore(); f.close(); }
});

test("V22 concurrent successful registrations consume an invitation exactly once", async () => {
  const f = await fixture();
  let count = 0;
  const verify = spyOn(webauthn, "verifyRegistrationResponse").mockImplementation(async options => {
    expect(options.expectedRPID).toBe("control.example.com"); expect(options.requireUserVerification).toBe(true);
    await Bun.sleep(10); return successfulVerification(Buffer.from(`credential-${++count}`).toString("base64url"));
  });
  try {
    const invitation = await f.invite("viewer"), a = await f.options(invitation.token), b = await f.options(invitation.token);
    const responses = await Promise.all([a, b].map(options => f.call(publicBase + "/verify", { token: invitation.token, response: f.attestation(options.challenge), nickname: "Friend's passkey", role: "admin" })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 410]);
    const cookie = responses.find(r => r.status === 200)!.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure");
    expect((await f.call("/api/auth/passkeys", undefined, cookie)).status).toBe(403);
    expect((await (await f.call("/api/me", undefined, cookie)).json()).data.role).toBe("viewer");
    expect(f.db.query("SELECT nickname FROM passkeys WHERE nickname IS NOT '__test__'").all()).toEqual([{ nickname: "Friend's passkey" }]);
    expect((await f.call(publicBase + "/info", { token: invitation.token })).status).toBe(410);
    expect((await f.call(publicBase + "/options", { token: invitation.token })).status).toBe(410);
    expect(f.db.query("SELECT 1 FROM passkey_invitation_challenges").get()).toBeNull();
  } finally { verify.mockRestore(); f.close(); }
});

test("V22 challenges bind to their invitation and expiry/revocation is rechecked after verification", async () => {
  const f = await fixture();
  const verify = spyOn(webauthn, "verifyRegistrationResponse").mockResolvedValue(successfulVerification("ZmFrZQ"));
  try {
    const a = await f.invite(), b = await f.invite(), challenge = await f.options(a.token);
    expect((await f.call(publicBase + "/verify", { token: b.token, response: f.attestation(challenge.challenge) })).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    f.db.run("UPDATE passkey_invitation_challenges SET created_at=unixepoch()-601");
    expect((await f.call(publicBase + "/verify", { token: a.token, response: f.attestation(challenge.challenge) })).status).toBe(400);
    const next = await f.options(a.token);
    verify.mockImplementation(async () => {
      f.db.run("UPDATE passkey_invitations SET revoked_at=unixepoch() WHERE id=?", [a.invitation.id]);
      return successfulVerification("ZmFrZQ");
    });
    expect((await f.call(publicBase + "/verify", { token: a.token, response: f.attestation(next.challenge) })).status).toBe(410);
    expect(f.db.query("SELECT 1 FROM passkeys WHERE nickname IS NOT '__test__'").get()).toBeNull();
    f.db.run("UPDATE passkey_invitations SET expires_at=unixepoch() WHERE id=?", [b.invitation.id]);
    expect((await f.call(publicBase + "/info", { token: b.token })).status).toBe(410);
    expect((await f.call(publicBase + "/info", { token: "x".repeat(43) })).status).toBe(410);
  } finally { verify.mockRestore(); f.close(); }
});

test("V21 revoked invitations remain invalid after reopening the database", async () => {
  const f = await fixture();
  try {
    const invitation = await f.invite();
    expect((await f.call(base + "/" + invitation.invitation.id, undefined, f.owner.cookie, "DELETE")).status).toBe(200);
    f.db.close(); f.ctx.db = initDb(f.dir);
    expect((await f.call(publicBase + "/options", { token: invitation.token })).status).toBe(410);
    f.ctx.db.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("V22 credential insertion failure rolls back invitation consumption", async () => {
  const f = await fixture();
  const verify = spyOn(webauthn, "verifyRegistrationResponse").mockResolvedValue(successfulVerification("ZmFrZQ"));
  try {
    f.db.run("INSERT INTO passkeys(credential_id,public_key,counter) VALUES (?,?,0)", [Buffer.from("ZmFrZQ", "base64url"), new Uint8Array([1])]);
    const invitation = await f.invite(), options = await f.options(invitation.token);
    expect((await f.call(publicBase + "/verify", { token: invitation.token, response: f.attestation(options.challenge) })).status).toBe(409);
    expect((await f.call(publicBase + "/info", { token: invitation.token })).status).toBe(200);
    verify.mockResolvedValue(successfulVerification("bmV3"));
    const retry = await f.options(invitation.token);
    expect((await f.call(publicBase + "/verify", { token: invitation.token, response: f.attestation(retry.challenge) })).status).toBe(200);
    expect(f.db.query<{ n: number }, []>("SELECT count(*) n FROM passkeys WHERE nickname IS NOT '__test__'").get()!.n).toBe(2);
  } finally { verify.mockRestore(); f.close(); }
});

test("V22 invitation expiry during verification prevents registration", async () => {
  const f = await fixture();
  const verify = spyOn(webauthn, "verifyRegistrationResponse").mockImplementation(async () => {
    f.db.run("UPDATE passkey_invitations SET expires_at=unixepoch()");
    return successfulVerification("ZmFrZQ");
  });
  try {
    const invitation = await f.invite(), options = await f.options(invitation.token);
    expect((await f.call(publicBase + "/verify", { token: invitation.token, response: f.attestation(options.challenge) })).status).toBe(410);
    expect(f.db.query("SELECT 1 FROM passkeys WHERE nickname IS NOT '__test__'").get()).toBeNull();
  } finally { verify.mockRestore(); f.close(); }
});

test("V21 invitation bodies are bounded and mutations require the CSRF header", async () => {
  const f = await fixture();
  try {
    const call = (body: string, withHeader = true) => dispatch(new Request("https://control.example.com" + base, { method: "POST",
      headers: { cookie: f.owner.cookie, ...(withHeader ? { "X-jmmp-Client": "1" } : {}) }, body }), f.ctx);
    expect((await call(JSON.stringify({ label: "x".repeat(65536) }))).status).toBe(413);
    expect((await call("{")).status).toBe(400);
    expect((await call("null")).status).toBe(400);
    expect((await call("{}", false)).status).toBe(403);
    expect(f.db.query("SELECT 1 FROM passkey_invitations").get()).toBeNull();
  } finally { f.close(); }
});

test("V23 wipe-passkeys invalidates outstanding invitations and their challenges", async () => {
  const f = await fixture();
  try {
    const invitation = await f.invite(); await f.options(invitation.token);
    const config = { ...f.ctx.cfg, listen: { host: "127.0.0.1", port: 39999 }, tailscaleAuto: false, logLevel: "error" };
    const path = join(f.dir, "config.json"); await Bun.write(path, JSON.stringify(config));
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../main.ts"), "wipe-passkeys"], {
      env: { ...process.env, JMMP_CONFIG: path }, stdout: "pipe", stderr: "pipe",
    });
    await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(await child.exited).toBe(0);
    expect(f.db.query("SELECT 1 FROM passkey_invitations").get()).toBeNull();
    expect(f.db.query("SELECT 1 FROM passkey_invitation_challenges").get()).toBeNull();
    expect(f.db.query("SELECT 1 FROM session_devices").get()).toBeNull();
    expect((await f.call(publicBase + "/info", { token: invitation.token })).status).toBe(410);
  } finally { f.close(); }
});

test("V41 invitations default to admin and reject invalid roles without creating links", async () => {
  const f = await fixture();
  try {
    for (const role of ["root", "DJ", "Viewer", "", null, 42, {}, []])
      expect((await f.call(base, { role }, f.owner.cookie)).status).toBe(400);
    expect(f.db.query("SELECT 1 FROM passkey_invitations").get()).toBeNull();
    const invitation = await f.invite();
    expect(invitation.invitation.role).toBe("admin");
    expect(f.db.query("SELECT role FROM passkey_invitations WHERE id=?").get(invitation.invitation.id)).toEqual({ role: "admin" });
  } finally { f.close(); }
});

test("V41 role migration preserves legacy admin invitations and constrains future roles", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE passkey_invitations(id INTEGER PRIMARY KEY); INSERT INTO passkey_invitations VALUES(1)");
    db.exec(roleMigration);
    expect(db.query("SELECT role FROM passkey_invitations WHERE id=1").get()).toEqual({ role: "admin" });
    expect(() => db.run("INSERT INTO passkey_invitations(id,role) VALUES(2,'root')")).toThrow();
    expect(() => db.run("INSERT INTO passkey_invitations(id,role) VALUES(2,NULL)")).toThrow();
  } finally { db.close(); }
});

test("V41 each invited role applies to the first session and recipient payload cannot elevate it", async () => {
  const f = await fixture();
  const verify = spyOn(webauthn, "verifyRegistrationResponse");
  try {
    for (const role of PASSKEY_ROLES) {
      const invitation = await f.invite(role);
      expect(invitation.invitation.role).toBe(role);
      const preview = (await (await f.call(publicBase + "/info", { token: invitation.token, role: "admin" })).json()).data;
      expect(preview.role).toBe(role);
      const options = await f.options(invitation.token);
      verify.mockResolvedValue(successfulVerification(Buffer.from("invited-" + role).toString("base64url")));
      const result = await f.call(publicBase + "/verify", { token: invitation.token, response: f.attestation(options.challenge), role: "admin" });
      expect(result.status).toBe(200);
      const cookie = result.headers.get("set-cookie")!;
      const me = (await (await f.call("/api/me", undefined, cookie)).json()).data;
      expect(me.role).toBe(role); expect(me.isPlayer).toBe(false);
      expect(f.db.query("SELECT role FROM passkeys WHERE id=?").get(me.passkeyId)).toEqual({ role });
      expect((await f.call("/api/auth/passkeys", undefined, cookie)).status).toBe(role === "admin" ? 200 : 403);
      expect((await f.call(publicBase + "/info", { token: invitation.token })).status).toBe(410);
    }
    const list = (await (await f.call(base, undefined, f.owner.cookie)).json()).data;
    expect(list.invitations.map((i: { role: PasskeyRole }) => i.role).sort()).toEqual([...PASSKEY_ROLES].sort());
  } finally { verify.mockRestore(); f.close(); }
});
