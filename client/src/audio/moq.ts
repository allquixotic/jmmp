// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Track, DspParams, PlaybackCommand, PlaybackStatus, MoqListener } from "@jmmp/shared";
import { DEFAULT_DSP_PARAMS } from "@jmmp/shared";
import { api } from "src/api";
import type * as Watch from "@moq/watch";
import type * as Net from "@moq/net";

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
  constructor(private publicListener = false) { super(); }
  private watch: Watch.Player | undefined;
  private connection: Net.Connection | undefined;
  private paused?: InstanceType<typeof Watch.Signals.Signal<boolean>>;
  private params = { ...DEFAULT_DSP_PARAMS };
  private serial: Promise<unknown> = Promise.resolve();
  private polling?: ReturnType<typeof setInterval>;
  private renewal?: ReturnType<typeof setTimeout>;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 500;
  private pollBusy = false;
  private playPending = 0;
  private lastRevision: number | undefined;
  private lastStatus: PlaybackStatus | undefined;
  private ended = "";
  private unavailable = "";
  private opening: Promise<void> | undefined;
  private pollAbort?: AbortController;
  private cleanups: Array<() => void> = [];
  private epoch = 0;
  private error(error: unknown) { this.dispatchEvent(new CustomEvent("error", { detail: String(error) })); this.dispatchEvent(new CustomEvent("state", { detail: "error" })); }
  async listen() {
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
    this.paused = new watch.Signals.Signal(false);
    this.watch = new watch.Player({ origin: this.connection.origin, probe: this.connection.probe,
      name: net.Path.from(listener.name), volume: 1, paused: this.paused, delay: "auto" });
    const resumeAudio = () => { void this.watch?.audio.out.context.peek()?.resume().catch(error => this.error(error)); };
    this.cleanups.push(this.watch.audio.out.context.subscribe(resumeAudio)); resumeAudio();
    document.addEventListener("pointerdown", resumeAudio);
    this.cleanups.push(() => document.removeEventListener("pointerdown", resumeAudio));
    this.cleanups.push(this.connection.error.subscribe(() => { const error = this.connection?.error.peek(); if (error) { this.error(error); this.reconnect(); } }));
    this.cleanups.push(this.connection.status.subscribe(() => {
      if (this.connection?.status.peek() === "connected") {
        this.retryDelay = 500; this.dispatchEvent(new CustomEvent("error", { detail: null }));
      }
    }));
    this.cleanups.push(this.connection.transport.subscribe(() => {
      this.dispatchEvent(new CustomEvent("transport", { detail: this.connection?.transport.peek() ?? "Connecting" }));
    }));
    this.cleanups.push(this.watch.audio.out.sampleRate.subscribe(() => {
      const rate = this.watch?.audio.out.sampleRate.peek();
      if (rate) this.dispatchEvent(new CustomEvent("audio", { detail: `Opus · ${rate / 1000} kHz` }));
    }));
    this.polling = setInterval(() => void this.poll(), 250);
    this.renewal = setTimeout(() => this.reconnect(), Math.max(1000, listener.expires * 1000 - Date.now() - 60000));
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
    if (this.publicListener) return Promise.reject(new Error("Public listeners cannot control playback"));
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
    try { const status = await api.get<PlaybackStatus>(this.publicListener ? "/api/public/moq/status" : "/api/playback", { signal: abort.signal }); if (mine === this.epoch && !this.playPending) this.apply(status); }
    catch (error) { if (mine === this.epoch) this.error(error); }
    finally { this.pollBusy = false; }
  }
  private apply(status: PlaybackStatus) {
    // A poll started before a seek/play command must not rewind state or advance
    // the queue using an ended event from the previous playback generation.
    const previous = this.lastStatus;
    if (previous && previous.instanceId !== status.instanceId) this.reconnect();
    if (previous?.instanceId === status.instanceId && previous &&
      (status.generation < previous.generation || status.revision < previous.revision)) return;
    this.lastStatus = status;
    this.paused?.set(["paused", "idle", "ended", "error"].includes(status.state));
    if (previous?.instanceId !== status.instanceId || status.revision !== this.lastRevision) { this.lastRevision = status.revision; if (status.error) this.error(status.error); }
    this.dispatchEvent(new CustomEvent("position", { detail: { position: status.position, duration: status.duration } }));
    if (status.state === "ended") {
      const ended = String(status.instanceId) + ":" + status.generation;
      if (this.ended === ended) return; this.ended = ended;
    }
    this.dispatchEvent(new CustomEvent("state", { detail: status.state === "buffering" ? "loading" : status.state }));
    const failure = `${status.instanceId}:${status.generation}`;
    if (!this.publicListener && status.state === "error" && status.errorCode === "spotify_unavailable" && status.trackId !== null && this.unavailable !== failure) {
      this.unavailable = failure;
      this.dispatchEvent(new CustomEvent("unavailable", { detail: { trackId: status.trackId, error: status.error } }));
    }
  }
  pause() { void this.send({ type: "pause" }).catch(() => {}); }
  resume() { void this.send({ type: "resume" }).catch(() => {}); }
  stop() { void this.send({ type: "stop" }).catch(() => {}); }
  async seek(position: number) { await this.send({ type: "seek", position }); }
  setParams(params: Partial<DspParams>) { this.params = { ...this.params, ...params }; if (this.watch) void this.send({ type: "params", params }).catch(() => {}); }
  setVolume(volume: number) { this.setParams({ volume }); }
  dispose(resetBackoff = true) {
    this.epoch++; clearInterval(this.polling); clearTimeout(this.renewal); clearTimeout(this.retry); this.retry = undefined;
    if (resetBackoff) this.retryDelay = 500;
    this.pollAbort?.abort(); this.opening = undefined;
    this.lastStatus = undefined; this.lastRevision = undefined;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.watch?.close(); this.connection?.close(); this.watch = undefined; this.connection = undefined;
  }
}
