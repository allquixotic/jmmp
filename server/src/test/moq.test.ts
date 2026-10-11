// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Net from "@moq/net";
import { RootSchema } from "@moq/hang/catalog";
import { DEFAULT_MOQ_SETTINGS, validateMoqSettings, validateDspParams } from "@jmmp/shared";
import { initDb } from "../db.ts";
import { loadOrInitMachineKey, encryptJson } from "../crypto.ts";
import { mintSession } from "../session.ts";
import { dispatch, type AppCtx } from "../router.ts";
import { playbackController } from "../audio/controller.ts";
import { redactMoqDiagnostics } from "../audio/helper.ts";
import { setLogLevel } from "../log.ts";
import { publicRequest, startPublicListener } from "../public-listener.ts";
import "../routes/index.ts";

test("V12: native diagnostics conceal publisher credentials in paths, queries and JWT fields", () => {
  const credential = "eyJhbGciOiJIUzI1NiJ9.eyJwdWJsaXNoIjp0cnVlfQ.secret-signature";
  const result = redactMoqDiagnostics(`Connection failed https://relay.example/${credential}\nws://relay.example/moq?jwt=${credential}\ncredential=${credential}\nreason: unauthorized`);
  expect(result).not.toContain(credential);
  expect(result).not.toContain("secret-signature");
  expect(result).not.toContain("relay.example");
  expect(result).toContain("reason: unauthorized");
});

async function setup() {
  setLogLevel("error");
  const dataDir = mkdtempSync(join(tmpdir(), "jmmp-moq-test-"));
  const ctx = { cfg: { dataDir, jwtSecret: "test-secret", sessionTtlDays: 1, webauthn: { origin: "http://localhost" } }, db: initDb(dataDir), machineKey: await loadOrInitMachineKey(dataDir) } as AppCtx;
  const minted = await mintSession(ctx, "owner", "full");
  const session = { did: "owner", scope: "full" as const, jti: minted.jti };
  const call = (path: string, method = "GET", body?: unknown) => dispatch(new Request(`http://localhost${path}`, {
    method, headers: { cookie: minted.cookie, "X-jmmp-Client": "1", ...(body instanceof Blob ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  }), ctx);
  const close = async () => { await playbackController(ctx).shutdown(); ctx.db.close(); rmSync(dataDir, { recursive: true, force: true }); };
  return { ctx, call, session, close };
}
function timeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("test timed out")), ms); })]).finally(() => clearTimeout(timer));
}
async function connect(url: string, name: string, keepCatalog = false) {
  const origin = new Net.Origin.Producer();
  const session = await Net.Connection.connect({ url: new URL(url), consume: origin, signal: AbortSignal.timeout(5000) });
  const request = origin.request(Net.Path.from(name));
  while (!request.active.peek()) await timeout(request.active.changed());
  const broadcast = request.active.peek()!;
  const catalog = broadcast.track("catalog.json").subscribe().ordered();
  const frame = await timeout(catalog.readFrame());
  expect(frame).toBeDefined();
  const json = JSON.parse(new TextDecoder().decode(frame!.payload));
  expect(RootSchema.safeParse(json).success).toBe(true);
  if (!keepCatalog) catalog.close();
  return { json, catalog, audio: broadcast.track("audio.opus").subscribe({ maxAge: Net.Time.Milli(5000) }).ordered(),
    async close() { catalog.close(); request.close(); origin.close(); await session.close(); } };
}

test("V1/V7: default output stays off; invalid configuration never persists", async () => {
  const app = await setup();
  try {
    expect(playbackController(app.ctx).snapshot().running).toBe(false);
    expect(playbackController(app.ctx).settings.enabled).toBe(false);
    expect((await app.call("/api/moq", "PUT", { ...DEFAULT_MOQ_SETTINGS, bitrate: NaN })).status).toBe(400);
    expect(app.ctx.db.query("SELECT 1 FROM settings WHERE key = 'moq'").get()).toBeNull();
    expect(() => validateMoqSettings({ ...DEFAULT_MOQ_SETTINGS, publicUrl: "http://music.example.com" })).toThrow();
    expect(() => validateDspParams({ tempoPct: -100 })).toThrow();
  } finally { await app.close(); }
});

test("V11/V12: public listener isolates all controller APIs and forwards subscribe-only WebSockets", async () => {
  const app = await setup();
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port!; probe.stop(true);
  const probe2 = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const publicPort = probe2.port!; probe2.stop(true);
  app.ctx.cfg.publicListener = { host: "127.0.0.1", port: publicPort, origin: "https://radio.example.com" };
  const request = (path: string, method = "GET") => publicRequest(new Request(`http://localhost${path}`, { method }), app.ctx);
  let server: ReturnType<typeof startPublicListener>;
  let listener: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    expect((await request("/api/public/moq/listener"))!.status).toBe(404);
    await playbackController(app.ctx).configure({ ...DEFAULT_MOQ_SETTINGS, enabled: true, port,
      publicListening: true, tlsOffload: true, publicUrl: "https://radio.example.com",
      websocketUrl: "wss://radio.example.com/moq" });
    server = startPublicListener(app.ctx);
    for (const path of ["/api/auth/status", "/api/auth/register/options", "/api/sources", "/api/catalog", "/api/moq", "/api/playback", "/api/stream/1", "/login", "/settings"]) {
      expect((await request(path))!.status).toBe(404);
      expect((await request(path, "POST"))!.status).toBe(404);
    }
    expect((await request("/api/public/moq/listener", "POST"))!.status).toBe(404);
    expect((await request("/"))!.headers.get("location")).toBe("https://radio.example.com/public-listen");
    const credentials = await (await request("/api/public/moq/listener"))!.json();
    expect(credentials.data.websocketUrl).toStartWith("wss://radio.example.com/moq?jwt=");
    expect(JSON.parse(Buffer.from(new URL(credentials.data.websocketUrl).searchParams.get("jwt")!.split(".")[1]!, "base64url").toString()).public).toBe(true);
    expect((await app.call("/api/moq/listener")).status).toBe(200);
    expect((await dispatch(new Request("http://localhost/api/moq/listener"), app.ctx)).status).toBe(401);
    listener = await connect(`http://127.0.0.1:${publicPort}/moq`, credentials.data.name, true);
    expect(listener.json.audio).toBeDefined();
    // A relay without joining FETCH still gets a fresh catalog while audio is idle.
    const refreshed = JSON.parse(new TextDecoder().decode((await timeout(listener.catalog.readFrame(), 5000))!.payload));
    expect(RootSchema.safeParse(refreshed).success).toBe(true);
    expect(refreshed.audio).toEqual(listener.json.audio);
    expect(refreshed.jmmp.revision).toBeGreaterThan(listener.json.jmmp?.revision ?? 0);
    playbackController(app.ctx).status.error = "Private source URL and credentials";
    const status = await (await request("/api/public/moq/status"))!.json();
    expect(status.data.error).toBe("Broadcast unavailable");
    expect(JSON.stringify(status)).not.toContain("credentials");
    expect(() => validateMoqSettings({ ...DEFAULT_MOQ_SETTINGS, tlsOffload: true, bind: "0.0.0.0" })).toThrow();
  } finally { await listener?.close(); server?.stop(true); await app.close(); }
}, 60000);

test("V5: local bytes precede catalog publication, survive upload, support ranges and reject traversal", async () => {
  const app = await setup();
  try {
    app.ctx.db.run("INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('local', 'Upload', '{}', 'all')");
    const track = { sourceId: 1, sourceTrackId: "album/song.flac", codec: "flac", title: "Tone" };
    expect((await app.call("/api/catalog/upload", "POST", { sourceId: 1, tracks: [track] })).status).toBe(400);
    expect((await app.call("/api/sources/1/upload?path=..%2Foutside.flac", "POST", new Blob(["x"]))).status).toBe(400);
    const fixture = Bun.file(join(import.meta.dir, "fixtures/tone.flac"));
    expect((await app.call("/api/sources/1/upload?path=album%2Fsong.flac", "POST", fixture)).status).toBe(200);
    expect((await app.call("/api/catalog/upload", "POST", { sourceId: 1, tracks: [track] })).status).toBe(200);
    const stream = await app.call("/api/stream/1");
    expect(new Uint8Array(await stream.arrayBuffer())).toEqual(new Uint8Array(await fixture.arrayBuffer()));
    const ranged = await dispatch(new Request("http://localhost/api/stream/1", { headers: { cookie: (await mintSession(app.ctx, "range", "full")).cookie, range: "bytes=4-15" } }), app.ctx);
    expect(ranged.status).toBe(206); expect((await ranged.arrayBuffer()).byteLength).toBe(12);
  } finally { await app.close(); }
});

test("V2/V4/V6/V8/V9: two authenticated listeners share one server source reader; controls and persistence work", async () => {
  const app = await setup(); let reads = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { reads++; return new Response(Bun.file(join(import.meta.dir, "fixtures/tone.flac"))); } });
  const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }); const port = portProbe.port!; portProbe.stop(true);
  const output = { ...DEFAULT_MOQ_SETTINGS, port, publicUrl: `http://localhost:${port}`, enabled: true };
  const listeners: Awaited<ReturnType<typeof connect>>[] = [];
  try {
    const creds = await encryptJson(app.ctx.machineKey, { kind: "s3", accessKeyId: "fixture", secretAccessKey: "fixture" });
    app.ctx.db.run("INSERT INTO sources (kind, name, config_json, creds_encrypted, cache_policy) VALUES ('s3', 'Fixture', ?, ?, 'all')", [JSON.stringify({ kind: "s3", endpoint: `http://127.0.0.1:${upstream.port}`, bucket: "test", region: "local", pathStyle: true }), creds]);
    app.ctx.db.run("INSERT INTO tracks (source_id, source_track_id, title, codec, duration_ms) VALUES (1, 'song.flac', 'Tone', 'flac', 1000)");
    let cancelled = false;
    const obsolete = playbackController(app.ctx).clientStream(new ReadableStream({ cancel() { cancelled = true; } }));
    const staleRead = obsolete.getReader().read().catch(() => ({ done: true }));
    await playbackController(app.ctx).configure(output);
    await staleRead; expect(cancelled).toBe(true);
    const listener = await playbackController(app.ctx).listener(app.session);
    // Native server-side probe exercises WebSocket fallback without any browser APIs.
    const wsUrl = listener.url.replace("localhost", "127.0.0.1");
    const denied = new URL(wsUrl); denied.searchParams.set("jwt", "invalid");
    await expect(Net.Connection.connect({ url: denied, signal: AbortSignal.timeout(5000) })).rejects.toThrow();
    listeners.push(await connect(wsUrl, listener.name), await connect(wsUrl, listener.name));
    expect(Object.values(listeners[0]!.json.audio.renditions).some((r: any) => r.codec === "opus")).toBe(true);
    expect((await app.call("/api/stream/1")).status).toBe(409);
    expect((await app.call("/api/playback", "POST", { command: { type: "play", trackId: 1 } })).status).toBe(409);
    app.ctx.db.run("UPDATE session_devices SET is_player = 1 WHERE id = 'owner'");
    const begin = performance.now();
    await playbackController(app.ctx).command({ type: "play", trackId: 1, params: { pitchSemi: 2, tempoPct: -50, volume: .5 } }, app.session);
    const [a, b] = await Promise.all(listeners.map(l => timeout((async () => {
      for (;;) { const frame = await l.audio.readFrame(); if (!frame || frame.payload.length > 8) return frame; }
    })())));
    expect(a?.payload.length).toBeGreaterThan(20); expect(b?.payload.length).toBeGreaterThan(20);
    expect(reads).toBe(1);
    await playbackController(app.ctx).command({ type: "pause" }, app.session);
    const paused = playbackController(app.ctx).status.position; await Bun.sleep(120);
    expect(Math.abs(playbackController(app.ctx).status.position - paused)).toBeLessThan(.04);
    await playbackController(app.ctx).command({ type: "seek", position: .25 }, app.session);
    expect(playbackController(app.ctx).status.generation).toBeGreaterThan(2);
    expect(playbackController(app.ctx).status.state).toBe("paused");
    const generation = playbackController(app.ctx).status.generation;
    await playbackController(app.ctx).configure(output);
    expect(playbackController(app.ctx).status.generation).toBe(generation);
    await playbackController(app.ctx).configure({ ...output, bitrate: 128000 });
    expect(playbackController(app.ctx).status.state).toBe("paused");
    expect(playbackController(app.ctx).status.trackId).toBe(1);
    await playbackController(app.ctx).command({ type: "resume" }, app.session);
    expect(performance.now() - begin).toBeGreaterThan(100);
    expect(JSON.parse((app.ctx.db.query<{ value_json: string }, []>("SELECT value_json FROM settings WHERE key = 'moq'").get()!).value_json).enabled).toBe(true);
    await playbackController(app.ctx).command({ type: "stop" }, app.session);
    await playbackController(app.ctx).configure({ ...output, enabled: false });
    expect(playbackController(app.ctx).running).toBe(false);
  } catch (error) { console.error("Playback status on failure", playbackController(app.ctx).status, "source reads", reads); throw error; } finally { for (const l of listeners) await l.close(); upstream.stop(true); await app.close(); }
}, 60000);

test("V5: upgrading legacy local catalogs marks browser-only tracks for reimport", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "jmmp-local-upgrade-"));
  let db = initDb(dataDir);
  try {
    db.run("ALTER TABLE tracks DROP COLUMN server_available");
    db.run("DROP TABLE local_files");
    db.run("DELETE FROM _schema_migrations WHERE version = 7");
    db.run("INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('local', 'Legacy folder', '{}', 'all')");
    db.run("INSERT INTO tracks (source_id, source_track_id, title, codec) VALUES (1, 'old.flac', 'Old file', 'flac')");
    db.close(); db = initDb(dataDir);
    expect(db.query<{ server_available: number }, []>("SELECT server_available FROM tracks").get()!.server_available).toBe(0);
    expect(db.query("SELECT 1 FROM local_files").get()).toBeNull();
  } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
});

test("V3/V4: audio worker paces PCM, applies volume and allows only one unacknowledged frame", async () => {
  const app = await setup();
  const worker = new Worker(new URL("../audio/worker.ts", import.meta.url).href);
  try {
    app.ctx.db.run("INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('local', 'Upload', '{}', 'all')");
    const upload = await app.call("/api/sources/1/upload?path=tone.flac", "POST", Bun.file(join(import.meta.dir, "fixtures/tone.flac")));
    const metadata = (await upload.json()).data.track;
    await app.call("/api/catalog/upload", "POST", { sourceId: 1, tracks: [metadata] });
    let frames = 0, maximum = 0, release = false;
    let first!: () => void, finish!: () => void, fail!: (error: unknown) => void;
    const firstFrame = new Promise<void>(resolve => { first = resolve; });
    const finished = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const start = performance.now();
    worker.onerror = event => fail(new Error(event.message));
    worker.onmessage = event => {
      const m = event.data;
      if (m.type === "pcm") {
        frames++; expect(m.pcm.length).toBe(1920);
        for (const sample of m.pcm) { if (!Number.isFinite(sample)) fail(new Error("Non-finite PCM")); maximum = Math.max(maximum, Math.abs(sample)); }
        first(); if (release) worker.postMessage({ type: "ack" });
      } else if (m.type === "ended") finish();
      else if (m.type === "error") fail(new Error(m.error));
    };
    worker.postMessage({ type: "start", generation: 1, dataDir: app.ctx.cfg.dataDir, trackId: 1, position: 0,
      params: { pitchSemi: 0, tempoPct: 0, speedPct: 0, gainDb: 0, volume: .5 } });
    await timeout(firstFrame); await Bun.sleep(100);
    expect(frames).toBe(1);
    release = true; worker.postMessage({ type: "ack" }); await timeout(finished);
    expect(frames).toBe(50); expect(performance.now() - start).toBeGreaterThan(900);
    expect(maximum).toBeGreaterThan(.04); expect(maximum).toBeLessThan(.05);
  } finally { worker.terminate(); await app.close(); }
}, 10000);
