// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_DSP_PARAMS, type Track, type DspParams, type PlaybackOutput } from "@jmmp/shared";
import { AudioPlayer, type PlaybackCacheOptions } from "./pipeline";
import { MoqPlayer } from "./moq";
import { api } from "src/api";
import { useSessionStore } from "src/stores/session";

/** Chooses exactly one audio path. MoQ never reads source bytes or OPFS. */
export class RoutingPlayer extends EventTarget {
  private local = new AudioPlayer();
  private moq = new MoqPlayer();
  private active: AudioPlayer | MoqPlayer = this.local;
  private track: Track | undefined;
  private cache: PlaybackCacheOptions | undefined;
  private position = 0;
  private state = "idle";
  private params = { ...DEFAULT_DSP_PARAMS };
  private switching = false;
  private playEpoch = 0;
  constructor() {
    super();
    for (const backend of [this.local, this.moq]) for (const name of ["state", "position", "error", "unavailable"]) backend.addEventListener(name, event => {
      if (this.active !== backend || this.switching) return;
      const detail = (event as CustomEvent).detail;
      if (name === "position") this.position = detail.position;
      if (name === "state") this.state = detail;
      this.dispatchEvent(new CustomEvent(name, { detail }));
    });
  }
  async refreshOutput(reconnect = false): Promise<void> {
    if (!navigator.onLine) {
      if (localStorage.getItem("jmmp-moq-enabled") === "true") throw new Error("MoQ playback requires a connection to the server");
      return;
    }
    const output = await api.get<PlaybackOutput>("/api/playback/output");
    const me = useSessionStore().me;
    if (me) { me.moqEnabled = output.enabled; me.streamUrl = output.listenUrl; }
    localStorage.setItem("jmmp-moq-enabled", String(output.enabled));
    const next = output.enabled ? this.moq : this.local;
    this.dispatchEvent(new CustomEvent("mode", { detail: output.enabled }));
    if (next === this.active) {
      if (reconnect && next === this.moq) { this.moq.dispose(); await this.moq.listen(); }
      return;
    }
    const track = this.track, position = this.position, paused = this.state === "paused";
    this.switching = true;
    try {
      this.local.stop(); this.moq.dispose(); this.active = next;
      this.active.setParams(this.params); this.active.setVolume(this.params.volume);
    } finally { this.switching = false; }
    if (track && !["idle", "ended", "error"].includes(this.state)) {
      if (this.active === this.moq) await this.moq.playAt(track, position, paused);
      else { await this.local.play(track, this.cache); if (position > 0) await this.local.seek(position); if (paused) this.local.pause(); }
    }
  }
  async play(track: Track, cache?: PlaybackCacheOptions) {
    // Clear track during selection so refreshOutput does not restart the old one.
    const mine = ++this.playEpoch;
    this.track = undefined; await this.refreshOutput();
    if (mine !== this.playEpoch) return;
    this.track = track; this.cache = cache; this.position = 0;
    await this.active.play(track, cache);
  }
  private controlBackend() { return useSessionStore().me?.moqEnabled ? this.moq : this.active; }
  pause() { this.controlBackend().pause(); }
  resume() { this.controlBackend().resume(); }
  stop() { this.playEpoch++; this.controlBackend().stop(); this.track = undefined; }
  /** Release this device's audio without issuing a shared playback command. */
  suspend() { this.playEpoch++; this.local.stop(); this.moq.dispose(); this.track = undefined; }
  async seek(seconds: number) { await this.controlBackend().seek(seconds); }
  setParams(params: Partial<DspParams>) { this.params = { ...this.params, ...params }; this.active.setParams(params); }
  controlParams(params: Partial<DspParams>) {
    this.params = { ...this.params, ...params };
    const backend = this.controlBackend();
    if (backend === this.moq) this.moq.controlParams(params); else backend.setParams(params);
  }
  setVolume(volume: number) { this.controlParams({ volume }); }
}
