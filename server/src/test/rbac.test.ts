// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PASSKEY_ROLES, DEFAULT_USER_SETTINGS, type PasskeyRole } from "@jmmp/shared";
import { initDb } from "../db.ts";
import { loadOrInitMachineKey } from "../crypto.ts";
import { mintSession } from "../session.ts";
import { issueSession } from "../jwt.ts";
import { dispatch, type AppCtx } from "../router.ts";
import { playbackController } from "../audio/controller.ts";
import { routePermission } from "../authorization.ts";
import migration from "../migrations/0010_passkey_roles.sql" with { type: "text" };
import "../routes/index.ts";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jmmp-rbac-")), db = initDb(dir);
  const ctx: AppCtx = { db, machineKey: await loadOrInitMachineKey(dir), cfg: {
    dataDir: dir, listen: { host: "127.0.0.1", port: 0 }, tailscaleAuto: false, logLevel: "error",
    jwtSecret: crypto.randomUUID(), sessionTtlDays: 1,
    webauthn: { rpId: "localhost", rpName: "Test", origin: "http://localhost" },
    publicListener: { host: "127.0.0.1", port: 0, origin: "https://radio.example.com" },
  } };
  const sessions = new Map<PasskeyRole, Awaited<ReturnType<typeof mintSession>> & { id: number }>();
  for (const role of PASSKEY_ROLES) {
    const row = db.run("INSERT INTO passkeys(credential_id,public_key,role,nickname) VALUES (?,?,?,?)", [Buffer.from(role), new Uint8Array([1]), role, role]);
    const id = Number(row.lastInsertRowid);
    sessions.set(role, { ...await mintSession(ctx, role, "full", id), id });
  }
  db.run("INSERT INTO sources(kind,name,config_json,cache_policy) VALUES ('local','Library',?, 'all')", [JSON.stringify({ kind: "local", label: "private configuration" })]);
  db.run("INSERT INTO tracks(source_id,source_track_id,title,artist,codec,duration_ms) VALUES (1,'a.mp3','A','Artist','mp3',1000)");
  const call = (role: PasskeyRole, method: string, path: string, body?: unknown, cookie?: string) => dispatch(new Request("http://localhost" + path, {
    method, headers: { cookie: cookie ?? sessions.get(role)!.cookie, "X-jmmp-Client": "1", Origin: "http://localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), ctx);
  return { ctx, db, sessions, call, close: async () => { await playbackController(ctx).shutdown(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("V37 credential defaults/migration, legacy session rejection and strict JWT scope/key isolation", async () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE passkeys(id INTEGER PRIMARY KEY); INSERT INTO passkeys VALUES(1); CREATE TABLE session_devices(id TEXT PRIMARY KEY,is_player INTEGER); INSERT INTO session_devices VALUES('legacy',1)");
  db.exec(migration);
  expect(db.query("SELECT role FROM passkeys").get()).toEqual({ role: "admin" });
  expect(db.query("SELECT passkey_id,is_player FROM session_devices").get()).toEqual({ passkey_id: null, is_player: 0 });
  db.close();
  const f = await fixture();
  try {
    const token = await issueSession(f.ctx.cfg.jwtSecret, "legacy", "full", 600);
    const { verifySession } = await import("../jwt.ts");
    const claims = (await verifySession(f.ctx.cfg.jwtSecret, token))!;
    f.db.run("INSERT INTO session_devices(id,jwt_jti) VALUES('legacy',?)", [claims.jti]);
    expect((await f.call("admin", "GET", "/api/me", undefined, "jmmp_session=" + token)).status).toBe(401);
    expect(await verifySession("another key", token)).toBeNull();
    const { SignJWT } = await import("jose");
    const invalid = await new SignJWT({ did: "legacy", scope: "unknown" }).setProtectedHeader({ alg: "HS256" }).setJti(claims.jti).sign(new TextEncoder().encode(f.ctx.cfg.jwtSecret));
    expect(await verifySession(f.ctx.cfg.jwtSecret, invalid)).toBeNull();
    f.db.run("INSERT INTO passkeys(credential_id,public_key) VALUES (?,?)", [Buffer.from("new"), new Uint8Array([1])]);
    expect(f.db.query("SELECT role FROM passkeys WHERE credential_id=?").get(Buffer.from("new"))).toEqual({ role: "admin" });
    expect(routePermission("GET", "/api/new-sensitive-endpoint")).toBe("admin");
  } finally { await f.close(); }
});

test("V39 every role can observe; only admin can query configuration or manage passkeys", async () => {
  const f = await fixture();
  try {
    for (const role of PASSKEY_ROLES) {
      for (const path of ["/api/me", "/api/settings", "/api/playback", "/api/playback/output", "/api/sources", "/api/playlists", "/api/catalog/tracks", "/api/catalog/search?q=Artist", "/api/queue", "/api/history"]) {
        expect((await f.call(role, "GET", path)).status).toBe(200);
      }
      for (const [method, path, body] of [
        ["GET", "/api/moq", undefined], ["PUT", "/api/moq", {}], ["POST", "/api/moq/test", {}],
        ["POST", "/api/moq/test/end", {}], ["GET", "/api/auth/passkeys", undefined],
        ["GET", "/api/auth/passkey/invitations", undefined], ["POST", "/api/auth/passkey/invitations", {}],
        ["GET", "/api/auth/passkey/register/options", undefined], ["POST", "/api/auth/passkey/register/verify", {}],
        ["PATCH", "/api/sources/1", {}], ["DELETE", "/api/sources/99", undefined],
        ["PATCH", "/api/auth/passkeys/1", { role: "admin" }], ["DELETE", "/api/auth/passkeys/99", undefined],
      ] as const) {
        const response = await f.call(role, method, path, body);
        if (role !== "admin") expect(response.status).toBe(403);
        else expect(response.status).not.toBe(403);
      }
      const sources = await (await f.call(role, "GET", "/api/sources")).json();
      expect(sources.data.sources[0].config !== undefined).toBe(role === "admin");
    }
  } finally { await f.close(); }
});

test("V38 concurrent viewers cannot displace owner or change playback, queue, settings or library", async () => {
  const f = await fixture();
  try {
    const output = playbackController(f.ctx); output.settings.enabled = true; output.settings.publicListening = true;
    expect((await f.call("admin", "POST", "/api/take-control", {})).status).toBe(200);
    const second = await mintSession(f.ctx, "second-viewer", "full", f.sessions.get("viewer")!.id);
    for (const cookie of [f.sessions.get("viewer")!.cookie, second.cookie]) {
      const me = await (await f.call("viewer", "GET", "/api/me", undefined, cookie)).json();
      expect(me.data.role).toBe("viewer"); expect(me.data.isPlayer).toBe(false); expect(me.data.playerConflict).toBeNull();
      expect(me.data.streamUrl).toBe("https://radio.example.com/public-listen");
      for (const [method, path, body] of [
        ["POST", "/api/take-control", {}], ["POST", "/api/heartbeat", {}],
        ["POST", "/api/playback", { command: { type: "pause" } }], ["PUT", "/api/queue", { trackIds: [1] }],
        ["POST", "/api/queue/append", { trackIds: [1] }], ["PUT", "/api/settings", { settings: { libraryView: "grid" } }],
        ["POST", "/api/history", { trackId: 1 }], ["POST", "/api/playlists", { name: "No" }],
        ["POST", "/api/sources", { kind: "local", name: "No", config: {} }], ["POST", "/api/sources/1/upload", {}],
        ["POST", "/api/catalog/upload", {}], ["POST", "/api/scan/1", {}],
      ] as const) expect((await f.call("viewer", method, path, body, cookie)).status).toBe(403);
    }
    expect(f.db.query("SELECT id FROM session_devices WHERE is_player=1").all()).toEqual([{ id: "admin" }]);
    expect(f.db.query("SELECT 1 FROM queue_entries").get()).toBeNull();
    expect(f.db.query("SELECT 1 FROM settings WHERE key='user'").get()).toBeNull();
    for (const role of ["player", "dj", "admin"] as const) {
      expect((await f.call(role, "POST", "/api/take-control", {})).status).toBe(200);
      expect(f.db.query("SELECT id FROM session_devices WHERE is_player=1").all()).toEqual([{ id: role }]);
      expect((await f.call(role, "PUT", "/api/queue", { trackIds: [1] })).status).toBe(200);
      expect((await f.call(role, "PUT", "/api/settings", { settings: DEFAULT_USER_SETTINGS })).status).toBe(200);
    }
    expect((await f.call("player", "PUT", "/api/queue", { trackIds: [] })).status).toBe(409);
    output.settings.enabled = false;
    expect((await f.call("player", "POST", "/api/take-control", {})).status).toBe(403);
    for (const role of PASSKEY_ROLES) {
      const response = await f.call(role, "GET", "/api/stream/999");
      expect(response.status).toBe(role === "viewer" || role === "player" ? 403 : 404);
    }
  } finally { await f.close(); }
});

test("V39 DJs CRUD playlists/add sources/upload metadata; players cannot and DJ deletion is denied", async () => {
  const f = await fixture();
  try {
    for (const role of PASSKEY_ROLES) {
      const created = await f.call(role, "POST", "/api/playlists", { name: role });
      const source = await f.call(role, "POST", "/api/sources", { kind: "local", name: role, config: { kind: "local", label: role } });
      if (role === "viewer" || role === "player") { expect(created.status).toBe(403); expect(source.status).toBe(403); continue; }
      expect(created.status).toBe(201); expect(source.status).toBe(201);
      const id = (await created.json()).data.id;
      expect((await f.call(role, "PATCH", "/api/playlists/" + id, { name: "Renamed", trackIds: [1] })).status).toBe(200);
      expect((await f.call(role, "DELETE", "/api/playlists/" + id)).status).toBe(200);
      const upload = await f.call(role, "POST", "/api/sources/1/upload");
      expect(upload.status).toBe(400); // Reaches upload validation, not a role denial.
    }
    expect((await f.call("dj", "POST", "/api/catalog/upload", { sourceId: 1, tracks: [], removedSourceTrackIds: ["a.mp3"] })).status).toBe(403);
    expect(f.db.query("SELECT title FROM tracks WHERE id=1").get()).toEqual({ title: "A" });
  } finally { await f.close(); }
});

test("V37/V40 labels persist, role changes affect existing sessions, downgrade releases lock and deletion revokes credentials", async () => {
  const f = await fixture();
  try {
    const target = f.sessions.get("dj")!.id, admin = f.sessions.get("admin")!.id;
    expect((await f.call("admin", "PATCH", "/api/auth/passkeys/" + target, { nickname: "  Friend's phone  " })).status).toBe(200);
    const list = await (await f.call("admin", "GET", "/api/auth/passkeys")).json();
    expect(list.data.passkeys.find((p: { id: number }) => p.id === target).nickname).toBe("Friend's phone");
    expect((await f.call("admin", "PATCH", "/api/auth/passkeys/" + target, { nickname: "x".repeat(121) })).status).toBe(400);
    expect((await f.call("admin", "PATCH", "/api/auth/passkeys/" + target, { role: "root" })).status).toBe(400);
    expect((await f.call("admin", "PATCH", "/api/auth/passkeys/" + admin, { role: "viewer" })).status).toBe(409);
    expect((await f.call("admin", "DELETE", "/api/auth/passkeys/" + admin)).status).toBe(409);
    expect((await f.call("dj", "POST", "/api/take-control", {})).status).toBe(200);
    expect((await f.call("admin", "PATCH", "/api/auth/passkeys/" + target, { role: "viewer" })).status).toBe(200);
    const me = await (await f.call("dj", "GET", "/api/me")).json();
    expect(me.data.role).toBe("viewer"); expect(me.data.isPlayer).toBe(false);
    expect((await f.call("dj", "POST", "/api/playlists", { name: "Denied" })).status).toBe(403);
    expect((await f.call("admin", "DELETE", "/api/auth/passkeys/" + target)).status).toBe(200);
    expect((await f.call("dj", "GET", "/api/me")).status).toBe(401);
  } finally { await f.close(); }
});

test("V37 a role downgrade during a streaming upload prevents its permanent commit", async () => {
  const f = await fixture();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; controller.enqueue(new Uint8Array([1])); } });
  const pending = dispatch(new Request("http://localhost/api/sources/1/upload?path=new.mp3", {
    method: "POST", headers: { cookie: f.sessions.get("dj")!.cookie, "X-jmmp-Client": "1" }, body: stream,
  }), f.ctx);
  try {
    let started = false;
    for (let n = 0; n < 100 && !started; n++) {
      try { started = readdirSync(join(f.ctx.cfg.dataDir, "uploads")).some(name => name.endsWith(".part")); } catch {}
      if (!started) await Bun.sleep(10);
    }
    expect(started).toBe(true);
    f.db.run("UPDATE passkeys SET role='viewer' WHERE id=?", [f.sessions.get("dj")!.id]);
    body.close();
    expect((await pending).status).toBe(403);
    expect(f.db.query("SELECT 1 FROM local_files").get()).toBeNull();
    expect(readdirSync(join(f.ctx.cfg.dataDir, "uploads"))).toEqual([]);
  } finally { try { body.close(); } catch {} await pending; await f.close(); }
});
