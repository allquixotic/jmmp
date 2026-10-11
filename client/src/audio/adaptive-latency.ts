// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export const LATENCY_STORAGE_KEY = "jmmp:moq-latency:v1";
type LatencyStorage = Pick<Storage, "getItem" | "setItem">;
function browserStorage(): LatencyStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** Receiver-local jitter budget in milliseconds, excluding codec/worklet delay. */
export class AdaptiveLatency {
  targetMs = 100;
  underruns = 0;
  private floorMs = 25;
  private minRtt = 0;
  private quietSince: number | undefined;
  private lastHealthy = -Infinity;
  private lastDecrease = -Infinity;

  constructor(private storage = browserStorage()) {
    try {
      const saved = JSON.parse(storage?.getItem(LATENCY_STORAGE_KEY) ?? "null") as unknown;
      if (!saved || typeof saved !== "object") return;
      const { version, targetMs, floorMs } = saved as Record<string, unknown>;
      if (version !== 1 || typeof targetMs !== "number" || typeof floorMs !== "number" ||
        !Number.isFinite(targetMs) || !Number.isFinite(floorMs) || targetMs < 25 || targetMs > 5000 || floorMs < 25 || floorMs > targetMs) return;
      this.targetMs = targetMs; this.floorMs = floorMs;
    } catch { /* Storage unavailable, malformed or blocked: use the initial prior. */ }
  }
  reset() {
    this.targetMs = 100; this.underruns = 0; this.floorMs = 25; this.minRtt = 0;
    this.quietSince = undefined; this.lastHealthy = -Infinity; this.lastDecrease = -Infinity;
    this.save();
  }
  /** Intentional silence, seek and track changes are not network jitter. */
  boundary(now: number) {
    this.disturbed(now);
  }
  /** Only observed healthy rendering, never arrival traffic, earns a decrease. */
  healthy(now: number) {
    if (!Number.isFinite(now)) return;
    if (this.quietSince === undefined || now - this.lastHealthy > 1000) this.quietSince = now;
    this.lastHealthy = now;
  }
  disturbed(_now: number) { this.quietSince = undefined; this.lastHealthy = -Infinity; }
  setRtt(rtt: number | undefined) {
    if (rtt === undefined || !Number.isFinite(rtt) || rtt <= 0) return;
    this.minRtt = this.minRtt ? Math.min(this.minRtt, rtt) : rtt;
  }
  underrun(now: number) {
    if (!Number.isFinite(now)) return;
    this.underruns++;
    // Remember a budget that actually failed, so subsequent probes don't keep
    // hunting through it. Persistence retains this safety floor too.
    this.floorMs = Math.min(5000, Math.max(this.floorMs, Math.ceil((this.targetMs + 25) / 25) * 25));
    this.raise(Math.max(this.targetMs * 1.5, this.targetMs + 150), now);
  }
  tick(now: number) {
    if (!Number.isFinite(now)) return;
    const required = this.floor();
    if (required > this.targetMs + 5) { this.raise(required, now); return; }
    // Ten uninterrupted minutes before probing; at most 5ms once a minute.
    // Interruptions/reconnects/refresh start the quiet period from scratch.
    if (this.quietSince === undefined || now - this.lastHealthy > 1000 ||
      now - this.quietSince < 600000 || now - this.lastDecrease < 60000) return;
    const next = Math.max(required, this.targetMs - 5);
    if (next < this.targetMs) { this.targetMs = next; this.lastDecrease = now; this.save(); }
  }
  private floor() { return Math.min(5000, Math.max(this.floorMs, this.minRtt * 1.25)); }
  private raise(value: number, now: number) {
    this.targetMs = Math.min(5000, Math.ceil(value / 25) * 25);
    this.disturbed(now); this.save();
  }
  private save() {
    try { this.storage?.setItem(LATENCY_STORAGE_KEY, JSON.stringify({ version: 1, targetMs: this.targetMs, floorMs: this.floorMs })); }
    catch { /* Quota/privacy failures must not interrupt audio. */ }
  }
}

/** Compare actual render progress with the audio clock, including recovered gaps. */
export class RenderHealth {
  private samples: Array<{ clock: number; media: number }> = [];
  reset() { this.samples = []; }
  sample(clock: number, media: number | undefined): "warming" | "healthy" | "gap" {
    if (!Number.isFinite(clock) || media === undefined || !Number.isFinite(media)) { this.reset(); return "warming"; }
    const last = this.samples.at(-1);
    if (last && (clock < last.clock || media < last.media || media - last.media > clock - last.clock + 250)) this.reset();
    this.samples.push({ clock, media });
    while (this.samples.length > 1 && clock - this.samples[1]!.clock >= 2000) this.samples.shift();
    const first = this.samples[0]!;
    const elapsed = clock - first.clock, missing = elapsed - (media - first.media);
    // Upstream signals lag by at most a few worklet/poll intervals. Accumulate
    // loss over two seconds, rather than missing dropouts that recover between polls.
    if (missing > 100) return "gap";
    return elapsed >= 500 && missing <= 50 ? "healthy" : "warming";
  }
}

export interface ListenerLatency {
  playoutMs: number;
  underruns: number;
  buffering: boolean;
}
