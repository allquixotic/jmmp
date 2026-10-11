// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { SignJWT, jwtVerify } from "jose";
import { DEFAULT_DSP_PARAMS, DEFAULT_MOQ_SETTINGS, validateDspParams, validateMoqSettings,
  type MoqSettings, type PlaybackCommand, type PlaybackStatus, type MoqListener, type NowPlayingTrack } from "@jmmp/shared";
import type { AppCtx } from "../router.ts";
import type { ActiveSession } from "../session.ts";
import { NativeOutput } from "./helper.ts";

export class PlaybackController {
  settings = { ...DEFAULT_MOQ_SETTINGS };
  status: PlaybackStatus = { instanceId: crypto.randomUUID(), revision: 0, generation: 0, trackId: null, position: 0, duration: 0, state: "idle", params: { ...DEFAULT_DSP_PARAMS }, error: null };
  error: string | null = null;
  private helper?: NativeOutput;
  private worker?: Worker;
  private authServer?: ReturnType<typeof Bun.serve>;
  private key = crypto.getRandomValues(new Uint8Array(32));
  private serial: Promise<unknown> = Promise.resolve();
  private testTimer?: ReturnType<typeof setTimeout>;
  private sourceReaders = new Set<() => Promise<void>>();
  private enabling = false;
  constructor(private ctx: AppCtx) {
    const row = ctx.db.query<{ value_json: string }, []>("SELECT value_json FROM settings WHERE key = 'moq'").get();
    if (row) { try { this.settings = validateMoqSettings(JSON.parse(row.value_json)); } catch (error) { this.error = String(error); } }
  }
  get running() { return !!this.helper?.alive; }
  get browserStreamingAllowed() { return !this.settings.enabled && !this.enabling; }
  nowPlaying(): NowPlayingTrack | null {
    if (!this.status.trackId || !["buffering", "playing", "paused"].includes(this.status.state)) return null;
    return this.ctx.db.query<NowPlayingTrack, [number]>("SELECT title,artist FROM tracks WHERE id=?").get(this.status.trackId);
  }
  snapshot() { return { settings: this.settings, running: this.running, error: this.error, playback: structuredClone(this.status) }; }
  async initialize() { if (this.settings.enabled) { try { await this.start(this.settings); } catch (error) { this.fail(String(error)); } } }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.serial.then(run); this.serial = result.catch(() => {}); return result;
  }
  configure(value: unknown) {
    return this.exclusive(async () => {
      const next = validateMoqSettings(value), previous = this.settings;
      if (JSON.stringify(next) === JSON.stringify(previous) && (!next.enabled || this.running)) return this.snapshot();
      const playback = structuredClone(this.status);
      this.enabling = next.enabled;
      try {
        if (next.enabled) await Promise.all([...this.sourceReaders].map(cancel => cancel()));
        await this.shutdown();
        try { if (next.enabled) await this.start(next); }
        catch (error) {
          if (previous.enabled) {
            try { await this.start(previous); await this.restorePlayback(playback); }
            catch (restore) { this.fail(String(restore)); }
          }
          throw error;
        }
        this.settings = next; this.error = null;
        if (next.enabled && previous.enabled) await this.restorePlayback(playback);
        this.ctx.db.run(`INSERT INTO settings (key, value_json) VALUES ('moq', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = unixepoch()`, [JSON.stringify(next)]);
        return this.snapshot();
      } finally { this.enabling = false; }
    });
  }
  private async restorePlayback(playback: PlaybackStatus) {
    if (playback.trackId && ["playing", "paused", "buffering"].includes(playback.state)) {
      this.status.trackId = playback.trackId; this.status.duration = playback.duration;
      await this.restart(playback.position, playback.state === "paused");
    }
  }
  /** Stop browser source/cache downloads when the server takes over playback. */
  clientStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = stream.getReader();
    let output: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;
    const cancel = async () => {
      if (closed) return; closed = true; this.sourceReaders.delete(cancel);
      output.error(new Error("Playback switched to MoQ")); await reader.cancel().catch(() => {});
    };
    this.sourceReaders.add(cancel);
    return new ReadableStream({
      start(controller) { output = controller; },
      pull: async controller => {
        try { const result = await reader.read(); if (closed) return;
          if (result.done) { closed = true; this.sourceReaders.delete(cancel); controller.close(); }
          else controller.enqueue(result.value);
        } catch (error) { if (!closed) { closed = true; this.sourceReaders.delete(cancel); controller.error(error); } }
      },
      cancel: async () => { closed = true; this.sourceReaders.delete(cancel); await reader.cancel().catch(() => {}); },
    });
  }
  test(value: unknown, session: ActiveSession) {
    return this.exclusive(async () => {
      const settings = validateMoqSettings(value);
      if (this.running && JSON.stringify({ ...settings, enabled: this.settings.enabled }) !== JSON.stringify(this.settings)) throw new Error("Disable MoQ before testing different relay settings");
      if (!this.running) {
        await this.start(settings);
        clearTimeout(this.testTimer);
        this.testTimer = setTimeout(() => { if (!this.settings.enabled) void this.exclusive(() => this.shutdown()); }, 60000);
      }
      return this.listener(session, settings.publicUrl);
    });
  }
  endTest() { return this.exclusive(async () => { if (!this.settings.enabled) await this.shutdown(); }); }
  async listener(session: ActiveSession | null, base = this.settings.publicUrl): Promise<MoqListener> {
    if (!this.running) throw new Error(this.error ?? "MoQ output is disabled");
    if (!session && !this.settings.publicListening) throw new Error("Public listening is disabled");
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const jwt = await new SignJWT(session ? { did: session.did, jti: session.jti } : { public: true }).setProtectedHeader({ alg: "HS256" }).setAudience("jmmp-moq").setExpirationTime(expires).sign(this.key);
    const url = new URL(base); url.searchParams.set("jwt", jwt);
    const transport = new URL(url);
    // Chromium QUIC does not reliably fall back between localhost IP families.
    if (transport.protocol === "http:" && transport.hostname === "localhost") transport.hostname = this.helper?.bind.includes(":") ? "[::1]" : "127.0.0.1";
    transport.protocol = "https:";
    const websocket = this.settings.websocketUrl ? new URL(this.settings.websocketUrl) : url;
    websocket.searchParams.set("jwt", jwt);
    return { url: this.settings.webtransportUrl || url.href,
      webtransportUrl: this.settings.webtransportUrl || transport.href,
      websocketUrl: websocket.href, name: this.helper!.name,
      fingerprint: !this.settings.webtransportUrl && new URL(base).protocol === "http:" ? this.helper?.fingerprint : undefined, expires };
  }
  private async start(settings: MoqSettings) {
    const secretPath = `/${crypto.randomUUID()}`;
    this.authServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
      if (new URL(request.url).pathname !== secretPath || request.method !== "POST") return new Response(null, { status: 403 });
      try {
        const body = await request.json() as { query?: string; event?: string };
        if (body.event === "end") return Response.json({});
        const token = new URLSearchParams(body.query).get("jwt"); if (!token) throw new Error("Credential required");
        const { payload } = await jwtVerify(token, this.key, { audience: "jmmp-moq", algorithms: ["HS256"] });
        if (payload.public === true) { if (!this.settings.publicListening) throw new Error("Public listening disabled"); }
        else {
          const device = this.ctx.db.query<{ jwt_jti: string }, [string]>("SELECT jwt_jti FROM session_devices WHERE id = ?").get(String(payload.did));
          if (!device || device.jwt_jti !== payload.jti) throw new Error("Session revoked");
        }
        return Response.json({ root: "", subscribe: [this.helper!.name], publish: [], expires: payload.exp, revalidate: 30 });
      } catch { return new Response(null, { status: 403 }); }
    }});
    const helper = this.helper = new NativeOutput();
    this.status.instanceId = crypto.randomUUID();
    helper.onFailure = error => this.fail(error);
    try {
      const cfg = this.ctx.cfg.moqUpstream;
      let upstream: { url: string; protocol: string } | undefined;
      if (cfg) {
        const url = (await Bun.file(cfg.publisherUrlFile).text()).trim();
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) throw new Error("Upstream publisher file must contain an HTTPS relay URL");
        upstream = { url, protocol: cfg.protocol };
      }
      await helper.start(settings, this.ctx.cfg.dataDir, `http://127.0.0.1:${this.authServer.port}${secretPath}`, upstream);
    }
    catch (error) { await this.shutdown(); throw error; }
  }
  private fail(error: string) {
    this.error = error; this.status.error = error; this.status.state = "error"; this.status.revision++; this.status.generation++;
    this.worker?.terminate(); this.worker = undefined;
  }
  command(command: PlaybackCommand, session: ActiveSession, revision?: number) {
    return this.exclusive(async () => {
      const owner = this.ctx.db.query<{ is_player: number }, [string]>("SELECT is_player FROM session_devices WHERE id = ?").get(session.did);
      if (owner?.is_player !== 1) throw new Error("Only the current playback controller can change playback");
      if (!this.settings.enabled || !this.running) throw new Error(this.error ?? "MoQ output is disabled");
      if (revision !== undefined && revision !== this.status.revision) throw new Error("Playback changed; refresh before sending controls");
      if (!command || typeof command !== "object") throw new Error("Playback command required");
      switch (command.type) {
        case "play": {
          if (!Number.isSafeInteger(command.trackId) || command.trackId <= 0) throw new Error("Invalid track id");
          const track = this.ctx.db.query<{ duration_ms: number }, [number]>("SELECT duration_ms FROM tracks WHERE id = ?").get(command.trackId);
          if (!track) throw new Error("Track not found");
          const duration = (track.duration_ms ?? 0) / 1000, position = command.position ?? 0;
          if (!Number.isFinite(position) || position < 0 || (duration && position > duration)) throw new Error("Invalid seek position");
          if (command.paused !== undefined && typeof command.paused !== "boolean") throw new Error("Invalid paused flag");
          this.status.params = validateDspParams({ ...this.status.params, ...command.params });
          this.status.trackId = command.trackId; this.status.duration = (track.duration_ms ?? 0) / 1000;
          await this.restart(position, command.paused ?? false); break;
        }
        case "seek": await this.restart(command.position); break;
        case "params": this.status.params = validateDspParams({ ...this.status.params, ...command.params }); this.worker?.postMessage({ type: "params", params: this.status.params }); break;
        case "pause": if (this.worker && this.status.trackId && this.status.state !== "ended") { this.status.state = "paused"; this.worker.postMessage({ type: "pause", paused: true }); await this.helper!.write(1, this.status.generation); } break;
        case "resume": if (this.worker && this.status.state === "paused") { await this.helper!.write(1, this.status.generation); this.status.state = "playing"; this.worker.postMessage({ type: "pause", paused: false }); } break;
        case "stop": await this.stopPlayback(); break;
        default: throw new Error("Unknown playback command");
      }
      this.status.revision++; return structuredClone(this.status);
    });
  }
  private async restart(position: number, paused = this.status.state === "paused") {
    if (!Number.isFinite(position) || position < 0 || (this.status.duration && position > this.status.duration)) throw new Error("Invalid seek position");
    if (!this.status.trackId) throw new Error("No track selected");
    this.worker?.terminate(); this.worker = undefined; this.status.generation++;
    const generation = this.status.generation;
    await this.helper!.write(1, generation);
    this.status.position = position; this.status.state = paused ? "paused" : "buffering"; this.status.error = null;
    const worker = this.worker = new Worker(this.helper!.workerPath);
    worker.onerror = event => { if (generation === this.status.generation) this.fail(event.message); };
    worker.onmessage = event => {
      const m = event.data;
      if (m.generation !== this.status.generation) return;
      if (m.type === "pcm") {
        if (this.status.state === "paused") { worker.postMessage({ type: "ack" }); return; }
        void this.helper!.write(0, generation, m.pcm).then(() => worker.postMessage({ type: "ack" })).catch(error => { if (generation === this.status.generation) this.fail(String(error)); });
        if (this.status.state === "buffering") this.status.state = "playing";
      } else if (m.type === "position") { this.status.position = m.position; if (m.duration) this.status.duration = m.duration; }
      else if (m.type === "ended") { this.status.position = m.position; this.status.state = "ended"; this.status.revision++; void this.helper?.write(1, generation).catch(error => { if (generation === this.status.generation) this.fail(String(error)); }); }
      else if (m.type === "error") this.fail(m.error);
    };
    worker.postMessage({ type: "start", dataDir: this.ctx.cfg.dataDir, generation, trackId: this.status.trackId, position, paused, params: this.status.params });
  }
  private async stopPlayback() {
    this.worker?.terminate(); this.worker = undefined; this.status.generation++;
    if (this.running) await this.helper!.write(1, this.status.generation);
    this.status.state = "idle"; this.status.trackId = null; this.status.position = 0; this.status.error = null;
  }
  async shutdown() {
    clearTimeout(this.testTimer); await this.stopPlayback(); await this.helper?.close(); this.helper = undefined;
    this.authServer?.stop(true); this.authServer = undefined;
  }
}
const controllers = new WeakMap<AppCtx, PlaybackController>();
export function playbackController(ctx: AppCtx) {
  let controller = controllers.get(ctx); if (!controller) { controller = new PlaybackController(ctx); controllers.set(ctx, controller); }
  return controller;
}
