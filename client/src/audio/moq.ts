// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Track, DspParams, PlaybackCommand, PlaybackStatus, MoqListener } from "@jmmp/shared";
import { DEFAULT_DSP_PARAMS } from "@jmmp/shared";
import { api } from "src/api";
import type * as Watch from "@moq/watch";
import type * as Net from "@moq/net";
import { AdaptiveLatency, RenderHealth, type ListenerLatency } from "./adaptive-latency";
import { requestPlaybackAudioSession } from "./audio-session";
import { BackgroundPlayout } from "./background-playout";

function deadline<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 5000); })]).finally(() => clearTimeout(timer));
}
async function checkAudioSupport() {
  if (typeof AudioDecoder === "undefined" || !(await AudioDecoder.isConfigSupported({ codec: "opus", sampleRate: 48000, numberOfChannels: 2 })).supported) throw new Error("MoQ playback requires WebCodecs Opus decoding in this browser");
}
export async function testMoqConnection(listener: MoqListener): Promise<string> {
  await checkAudioSupport();
  const catalog = await import("@moq/hang/catalog");
  const { Connection, Path, Origin } = await import("@moq/net");
  const origin = new Origin.Producer();
  const session = await Connection.connect({ ...listenerOptions(listener), consume: origin, signal: AbortSignal.timeout(10000) });
  try {
    // Authentication and catalog subscription, not just a TCP reachability check.
    const broadcast = origin.request(Path.from(listener.name));
    const consumer = await deadline((async () => { while (!broadcast.active.peek()) { await Promise.race([broadcast.active.changed(), broadcast.closed.then(error => { throw error ?? new Error("Broadcast closed"); })]); } return broadcast.active.peek()!; })(), "Broadcast subscription timed out");
    const track = consumer.track("catalog.json").subscribe().ordered();
    try {
      const frame = await deadline((async () => { const group = await track.nextGroup(); if (!group) throw new Error("Catalog stream ended"); try { return await group.readFrame(); } finally { group.close(); } })(), "Catalog subscription timed out");
      if (!frame) throw new Error("Relay did not publish a catalog");
      const decoded = catalog.RootSchema.parse(JSON.parse(new TextDecoder().decode(frame.payload)));
      if (!Object.values(decoded.audio?.renditions ?? {}).some(r => r.codec === "opus")) throw new Error("Relay did not advertise Opus audio");
    }
    finally { track.close(); broadcast.close(); }
    return session.transport;
  } finally { await session.close(); origin.close(); }
}
export function listenerOptions(listener: MoqListener): Pick<Net.Connection.ConnectProps, "url" | "webtransport" | "websocket"> {
  const url = new URL(listener.url);
  const websocket = new URL(listener.websocketUrl || url);
  websocket.protocol = ["https:", "wss:"].includes(websocket.protocol) ? "wss:" : "ws:";
  const webtransportUrl = listener.webtransportUrl ? new URL(listener.webtransportUrl) : url;
  webtransportUrl.protocol = "https:";
  // HTTP on localhost supplies a generated certificate pin. A trusted CDN
  // certificate uses the browser's normal PKI verification.
  return { url: webtransportUrl, ...(listener.fingerprint ? { webtransport: { serverCertificateHashes: [{ value: listener.fingerprint }] } } : {}), websocket: { url: websocket } };
}

export class MoqPlayer extends EventTarget {
  constructor(private publicListener = false, private readOnly = false) { super(); }
  private watch: Watch.Player | undefined;
  private connection: Net.Connection | undefined;
  private watchModule: typeof Watch | undefined;
  private netModule: typeof Net | undefined;
  private listenerName = "";
  private delay?: InstanceType<typeof Watch.Signals.Signal<Net.Time.Milli>>;
  private enabled?: InstanceType<typeof Watch.Signals.Signal<boolean>>;
  private rearming?: ReturnType<typeof setTimeout>;
  private latency = new AdaptiveLatency();
  private mediaCleanups: Array<() => void> = [];
  private monitoring?: ReturnType<typeof setInterval>;
  private mediaProgressAt = 0;
  private heardAudio = false;
  private refillUntil = 0;
  private renderHealth = new RenderHealth();
  private gapActive = false;
  private healthySince: number | undefined;
  private underrun: ReturnType<typeof setTimeout> | undefined;
  private paused?: InstanceType<typeof Watch.Signals.Signal<boolean>>;
  private params = { ...DEFAULT_DSP_PARAMS };
  private serial: Promise<unknown> = Promise.resolve();
  private polling?: ReturnType<typeof setInterval>;
  private renewal?: ReturnType<typeof setTimeout>;
  private renewalPending = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 500;
  private pollBusy = false;
  private playPending = 0;
  private lastRevision: number | undefined;
  private lastStatus: PlaybackStatus | undefined;
  private ended = "";
  private unavailable = "";
  private opening: Promise<void> | undefined;
  private pollAbort: AbortController | undefined;
  private cleanups: Array<() => void> = [];
  private epoch = 0;
  private background = new BackgroundPlayout();
  private listenerPaused = false;
  private error(error: unknown) { this.dispatchEvent(new CustomEvent("error", { detail: String(error) })); this.dispatchEvent(new CustomEvent("state", { detail: "error" })); }
  async listen() {
    requestPlaybackAudioSession();
    if (this.watch) return;
    if (this.opening) return this.opening;
    const opening = this.open();
    this.opening = opening;
    try { await opening; } finally { if (this.opening === opening) this.opening = undefined; }
  }
  private async open() {
    const mine = this.epoch;
    await checkAudioSupport();
    const [watch, net, listener] = await Promise.all([import("@moq/watch"), import("@moq/net"), api.get<MoqListener>(this.publicListener ? "/api/public/moq/listener" : "/api/moq/listener")]);
    if (mine !== this.epoch) return;
    this.connection = new net.Connection({ ...listenerOptions(listener), linger: net.Time.Milli(0) });
    this.watchModule = watch; this.netModule = net; this.listenerName = listener.name;
    // Wait for authoritative status before rendering cached media from an idle
    // broadcast. The first accepted playing/buffering status unlocks playback.
    this.paused = new watch.Signals.Signal(true);
    this.restartMedia();
    const resumeAudio = () => {
      if (this.listenerPaused) return;
      requestPlaybackAudioSession();
      void this.watch?.audio.out.context.peek()?.resume().catch(error => this.error(error));
    };
    document.addEventListener("pointerdown", resumeAudio);
    this.cleanups.push(() => document.removeEventListener("pointerdown", resumeAudio));
    const visibility = () => {
      const now = performance.now();
      this.background.visibility(document.visibilityState !== "visible", now);
      clearTimeout(this.underrun); this.underrun = undefined;
      this.latency.disturbed(now); this.renderHealth.reset(); this.healthySince = undefined;
      this.mediaProgressAt = now; this.updateLatency();
      if (document.visibilityState === "visible") {
        if (this.renewalPending) { this.renewalPending = false; this.reconnect(); }
        if (this.expectedAudio()) resumeAudio();
        void this.poll();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", visibility));
    if (document.visibilityState !== "visible") visibility();
    this.cleanups.push(this.connection.error.subscribe(() => { const error = this.connection?.error.peek(); if (error) { this.error(error); this.reconnect(); } }));
    this.cleanups.push(this.connection.status.subscribe(() => {
      if (this.connection?.status.peek() === "connected") {
        this.retryDelay = 500; this.dispatchEvent(new CustomEvent("error", { detail: null }));
      }
    }));
    this.cleanups.push(this.connection.transport.subscribe(() => {
      this.dispatchEvent(new CustomEvent("transport", { detail: this.connection?.transport.peek() ?? "Connecting" }));
    }));
    this.polling = setInterval(() => void this.poll(), 250);
    this.monitoring = setInterval(() => this.monitorMedia(), 250);
    void this.poll();
    this.renewal = setTimeout(() => {
      // Tokens authorize new connections. Keep an already authorized healthy
      // receiver alive while hidden; actual transport failures still reconnect.
      if (document.visibilityState !== "visible") this.renewalPending = true;
      else this.reconnect();
    }, Math.max(1000, listener.expires * 1000 - Date.now() - 60000));
  }
  async resync() {
    this.dispose(); this.latency.reset(); this.resetMonitoring();
    const mine = this.epoch;
    this.dispatchEvent(new CustomEvent("error", { detail: null }));
    this.dispatchEvent(new CustomEvent("state", { detail: "loading" }));
    this.dispatchEvent(new CustomEvent("latency", { detail: { playoutMs: this.latency.targetMs, underruns: 0, buffering: true } satisfies ListenerLatency }));
    try { await this.listen(); }
    catch (error) { if (mine === this.epoch) { this.error(error); this.reconnect(); } }
  }
  private expectedAudio() { return this.lastStatus?.state === "playing" || this.lastStatus?.state === "buffering"; }
  private resetMonitoring() {
    clearTimeout(this.underrun); this.underrun = undefined; this.heardAudio = false;
    this.gapActive = false; this.healthySince = undefined; this.renderHealth.reset();
    const now = performance.now();
    this.latency.boundary(now); this.mediaProgressAt = now;
    this.refillUntil = now + this.latency.targetMs + 500;
  }
  private restartMedia() {
    const watch = this.watchModule, net = this.netModule, connection = this.connection;
    if (!watch || !net || !connection) return;
    this.resetMonitoring();
    if (this.watch) {
      // Restart only media demand. Keep the catalog subscription, transport and
      // AudioContext alive, including the user's audio-unlock gesture.
      const media = this.watch;
      this.enabled?.set(false); media.reset(); clearTimeout(this.rearming);
      this.rearming = setTimeout(() => { if (this.watch === media) this.enabled?.set(true); }, 0);
      return;
    }
    for (const cleanup of this.mediaCleanups.splice(0)) cleanup();
    this.enabled = new watch.Signals.Signal(true);
    this.delay = new watch.Signals.Signal(net.Time.Milli(this.background.delay(this.latency.targetMs, performance.now())));
    const media = this.watch = new watch.Player({ origin: connection.origin, probe: connection.probe,
      name: net.Path.from(this.listenerName), volume: 1, paused: this.paused!, enabled: this.enabled, delay: this.delay,
      // Keep backlog encoded, with backpressure; finite and below relay retention.
      buffer: net.Time.Milli(5000) });
    const resumeAudio = () => {
      if (this.listenerPaused) return;
      requestPlaybackAudioSession();
      void media.audio.out.context.peek()?.resume().catch(error => { if (this.watch === media) this.error(error); });
    };
    this.mediaCleanups.push(media.audio.out.context.subscribe(resumeAudio)); resumeAudio();
    let stalled = true, timestamp: number | undefined;
    this.mediaCleanups.push(media.audio.out.timestamp.subscribe(() => {
      const next = media.audio.out.timestamp.peek();
      if (next !== undefined && next !== timestamp) {
        if (next > (timestamp ?? 0)) this.heardAudio = true;
        timestamp = next; this.mediaProgressAt = performance.now();
      }
    }));
    this.mediaCleanups.push(media.audio.out.stalled.subscribe(() => {
      const next = media.audio.out.stalled.peek();
      if (next && !stalled) this.noteUnderrun();
      stalled = next;
    }));
    this.mediaCleanups.push(media.audio.out.sampleRate.subscribe(() => {
      const rate = media.audio.out.sampleRate.peek();
      if (rate) this.dispatchEvent(new CustomEvent("audio", { detail: `Opus · ${rate / 1000} kHz` }));
    }));
  }
  private noteUnderrun(renderGap = false) {
    const media = this.watch, generation = this.lastStatus?.generation;
    const scheduledAt = performance.now();
    if (!this.background.canConfirm(scheduledAt, scheduledAt) || this.listenerPaused ||
      !media || !this.heardAudio || this.gapActive || this.underrun || scheduledAt < this.refillUntil || this.lastStatus?.state !== "playing" ||
      media.audio.out.context.peek()?.state !== "running") return;
    this.latency.disturbed(performance.now()); this.healthySince = undefined;
    // Give status polling time to identify intentional cuts/EOF. Remember even
    // a recovered gap, but exclude our own deliberate latency refill.
    const observedAt = this.mediaProgressAt, timestamp = media.audio.out.timestamp.peek();
    this.underrun = setTimeout(() => {
      this.underrun = undefined;
      const now = performance.now(), current = media.audio.out.timestamp.peek();
      // A delayed main-thread poll is not a speaker dropout if the worklet's
      // playhead caught up with wall time. Confirm a real loss of render time.
      if (this.background.canConfirm(scheduledAt, now) && !this.listenerPaused &&
        this.watch === media && this.lastStatus?.generation === generation && this.lastStatus?.state === "playing" &&
        now >= this.refillUntil && media.audio.out.context.peek()?.state === "running" &&
        timestamp !== undefined && current !== undefined && current >= timestamp &&
        (renderGap || now - observedAt - (current - timestamp) > 100)) {
        this.recordUnderrun(now);
      }
    }, 500);
  }
  private recordUnderrun(now: number) {
    // A single ongoing stall is one failure, not repeated evidence that the
    // buffer must double. Resume healthy rendering before counting another.
    if (this.gapActive) return;
    this.gapActive = true; this.healthySince = undefined;
    this.latency.underrun(now); this.updateLatency();
  }
  private updateLatency() {
    if (!this.watch || !this.netModule) return;
    const now = performance.now(), target = this.background.delay(this.latency.targetMs, now);
    if (target > (this.delay?.peek() ?? 0)) {
      this.refillUntil = now + target + 500;
      this.latency.boundary(now); this.renderHealth.reset(); this.healthySince = undefined;
    }
    this.delay?.set(this.netModule.Time.Milli(target));
    this.dispatchEvent(new CustomEvent<ListenerLatency>("latency", { detail: {
      playoutMs: this.watch.sync.out.delay.peek(), underruns: this.latency.underruns,
      buffering: this.expectedAudio() && this.watch.audio.out.stalled.peek(),
    } }));
  }
  private monitorMedia() {
    if (!this.watch) return;
    const now = performance.now();
    if (!this.background.sample(now) || this.listenerPaused) {
      clearTimeout(this.underrun); this.underrun = undefined;
      this.latency.disturbed(now); this.renderHealth.reset(); this.healthySince = undefined;
      this.mediaProgressAt = now; this.updateLatency(); return;
    }
    this.latency.setRtt(this.connection?.probe.peek()?.rtt);
    const context = this.watch.audio.out.context.peek();
    if (this.lastStatus?.state === "playing" && context?.state === "running" && this.heardAudio && now >= this.refillUntil) {
      const health = this.renderHealth.sample(Number.isFinite(context.currentTime) ? context.currentTime * 1000 : now,
        this.watch.audio.out.timestamp.peek());
      if (health === "healthy") {
        this.healthySince ??= now;
        if (now - this.healthySince >= 500) this.gapActive = false;
        this.latency.healthy(now);
      } else {
        this.latency.disturbed(now); this.healthySince = undefined;
        if (health === "gap") this.noteUnderrun(true);
      }
      this.latency.tick(now);
    } else { this.latency.disturbed(now); this.renderHealth.reset(); this.healthySince = undefined; }
    // Some upstream ring implementations leave `stalled` false on exhaustion.
    // A stopped render playhead still identifies a real gap, including silent
    // songs (their timestamps advance normally). One pending observation at a time.
    if (now - this.mediaProgressAt > 150) this.noteUnderrun();
    this.updateLatency();
    // A broken ring/decoder can survive media rearming. Recover the entire
    // receiver automatically with fresh credentials, retaining learned delay.
    if (this.lastStatus?.state === "playing" && (!context || context.state === "running") &&
      now - this.mediaProgressAt > Math.max(8000, this.latency.targetMs + 3000)) this.reconnect();
  }
  private reconnect() {
    if (this.retry) return;
    const mine = this.epoch, delay = this.retryDelay;
    this.retryDelay = Math.min(10000, delay * 2);
    this.retry = setTimeout(() => {
      if (mine !== this.epoch) return;
      this.dispose(false); const attempt = this.epoch;
      void this.listen().catch(error => { if (attempt === this.epoch) { this.error(error); this.reconnect(); } });
    }, delay);
  }
  async play(track: Track) { await this.playAt(track, 0); }
  async playAt(track: Track, position: number, paused = false) {
    this.playPending++;
    try {
      const mine = this.epoch; await this.listen();
      if (mine === this.epoch) await this.send({ type: "play", trackId: track.id, position, paused, params: this.params });
    } finally { this.playPending--; }
  }
  private send(command: PlaybackCommand): Promise<void> {
    if (this.publicListener || this.readOnly) return Promise.reject(new Error("Public listeners cannot control playback"));
    const mine = this.epoch;
    const result = this.serial.then(async () => {
      if (mine !== this.epoch) return;
      // Read the latest revision after queued commands and server EOF events.
      const current = await api.get<PlaybackStatus>("/api/playback");
      if (mine !== this.epoch) return;
      const status = await api.post<PlaybackStatus>("/api/playback", { command, revision: current.revision });
      if (mine === this.epoch) this.apply(status);
    });
    this.serial = result.catch(error => { if (mine === this.epoch) this.error(error); }); return result;
  }
  private async poll() {
    if (this.pollBusy) return; this.pollBusy = true;
    const mine = this.epoch;
    const abort = this.pollAbort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);
    try { const status = await api.get<PlaybackStatus>(this.publicListener ? "/api/public/moq/status" : "/api/playback", { signal: abort.signal }); if (mine === this.epoch && !this.playPending) this.apply(status); }
    catch (error) { if (mine === this.epoch) this.error(error); }
    finally { clearTimeout(timeout); if (this.pollAbort === abort) { this.pollBusy = false; this.pollAbort = undefined; } }
  }
  private apply(status: PlaybackStatus) {
    // A poll started before a seek/play command must not rewind state or advance
    // the queue using an ended event from the previous playback generation.
    const previous = this.lastStatus;
    if (previous && previous.instanceId !== status.instanceId) this.reconnect();
    if (previous?.instanceId === status.instanceId && previous &&
      (status.generation < previous.generation || status.revision < previous.revision)) return;
    this.lastStatus = status;
    this.paused?.set(this.listenerPaused || ["paused", "idle", "ended", "error"].includes(status.state));
    if (previous && previous.instanceId === status.instanceId && previous.generation !== status.generation) this.restartMedia();
    else if (previous?.state !== status.state && this.expectedAudio() && previous?.state !== "playing" && previous?.state !== "buffering") {
      this.resetMonitoring();
    }
    if (previous?.error && !status.error) this.dispatchEvent(new CustomEvent("error", { detail: null }));
    if (previous?.instanceId !== status.instanceId || status.revision !== this.lastRevision) { this.lastRevision = status.revision; if (status.error) this.error(status.error); }
    this.dispatchEvent(new CustomEvent("position", { detail: { position: status.position, duration: status.duration } }));
    if (status.state === "ended") {
      const ended = String(status.instanceId) + ":" + status.generation;
      if (this.ended === ended) return; this.ended = ended;
    }
    this.dispatchEvent(new CustomEvent("state", { detail: status.state === "buffering" ? "loading" : status.state }));
    this.dispatchEvent(new CustomEvent("status", { detail: status }));
    const failure = `${status.instanceId}:${status.generation}`;
    if (!this.publicListener && !this.readOnly && status.state === "error" && status.errorCode === "spotify_unavailable" && status.trackId !== null && this.unavailable !== failure) {
      this.unavailable = failure;
      this.dispatchEvent(new CustomEvent("unavailable", { detail: { trackId: status.trackId, error: status.error } }));
    }
  }
  pause() { void this.send({ type: "pause" }).catch(() => {}); }
  resume() { requestPlaybackAudioSession(); void this.send({ type: "resume" }).catch(() => {}); }
  /** Local receiver control for public/observer pages; never writes server playback. */
  setListenerPaused(paused: boolean) {
    if (!this.publicListener && !this.readOnly) return;
    this.listenerPaused = paused;
    this.paused?.set(paused || !this.expectedAudio());
    this.resetMonitoring();
    if (!paused && this.expectedAudio()) {
      requestPlaybackAudioSession();
      void this.watch?.audio.out.context.peek()?.resume().catch(error => this.error(error));
    }
  }
  stop() { void this.send({ type: "stop" }).catch(() => {}); }
  async seek(position: number) { await this.send({ type: "seek", position }); }
  setParams(params: Partial<DspParams>) { this.params = { ...this.params, ...params }; if (this.watch) void this.send({ type: "params", params }).catch(() => {}); }
  /** Controls also work before this browser has opened an audio subscription. */
  controlParams(params: Partial<DspParams>) { this.params = { ...this.params, ...params }; void this.send({ type: "params", params }).catch(() => {}); }
  setVolume(volume: number) { this.setParams({ volume }); }
  dispose(resetBackoff = true) {
    this.background = new BackgroundPlayout();
    this.renewalPending = false;
    this.epoch++; clearInterval(this.polling); clearInterval(this.monitoring); clearTimeout(this.rearming); clearTimeout(this.underrun); this.underrun = undefined; clearTimeout(this.renewal); clearTimeout(this.retry); this.retry = undefined;
    if (resetBackoff) this.retryDelay = 500;
    this.pollAbort?.abort(); this.pollAbort = undefined; this.pollBusy = false; this.opening = undefined;
    this.lastStatus = undefined; this.lastRevision = undefined;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const cleanup of this.mediaCleanups.splice(0)) cleanup();
    this.watch?.close(); this.connection?.close(); this.watch = undefined; this.connection = undefined;
  }
}
