// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

/** Receiver-local jitter budget in milliseconds, excluding codec/worklet delay. */
export class AdaptiveLatency {
  targetMs = 100;
  underruns = 0;
  private history: Array<{ arrival: number; media: number; delay: number }> = [];
  private newest = -Infinity;
  private minRtt = 0;
  private started = 0;
  private lastRise = 0;
  private lastTick = 0;
  private cautious = false;
  private measured = 0;

  /** Intentional silence, seek and track changes are not network jitter. */
  boundary(now: number) {
    this.history = []; this.newest = -Infinity; this.measured = 0;
    this.started = this.lastRise = this.lastTick = now;
  }
  setRtt(rtt: number | undefined) {
    if (rtt === undefined || !Number.isFinite(rtt) || rtt <= 0) return;
    this.minRtt = this.minRtt ? Math.min(this.minRtt, rtt) : rtt;
  }
  observe(arrival: number, media: number) {
    if (!Number.isFinite(arrival) || !Number.isFinite(media) || media <= this.newest) return;
    this.newest = media;
    this.history = this.history.filter(sample => sample.media >= media - 2000).slice(-255);
    const baseline = Math.min(arrival - media, ...this.history.map(sample => sample.arrival - sample.media));
    const delay = Math.min(5000, Math.max(0, arrival - media - baseline));
    this.history.push({ arrival, media, delay });
    // A short rolling peak reacts to bursts that an RTT estimate cannot see.
    this.measured = Math.max(...this.history.map(sample => sample.delay));
    const required = this.floor();
    if (required > this.targetMs + 5) this.raise(required, arrival);
  }
  underrun(now: number) {
    if (!Number.isFinite(now)) return;
    this.underruns++;
    this.raise(Math.max(this.targetMs * 2, this.targetMs + 150), now);
  }
  tick(now: number) {
    if (!Number.isFinite(now)) return;
    const elapsed = Math.min(1000, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const latest = this.history.at(-1);
    if (!latest || now - latest.arrival > 500 || this.history.length < 10) return;
    const required = this.floor();
    if (required > this.targetMs + 5) { this.raise(required, now); return; }
    // Cold-start evidence may remove the prior quickly. After observed jitter,
    // wait thirty stable seconds, then release at most 5ms of delay per second.
    const cooling = this.cautious ? now - this.lastRise >= 30000 : now - this.started >= 2000;
    if (cooling) this.targetMs = Math.max(required, this.targetMs - elapsed * (this.cautious ? .005 : .02));
  }
  private floor() { return Math.min(5000, Math.max(25, this.minRtt * 1.25, this.measured + 20)); }
  private raise(value: number, now: number) {
    this.targetMs = Math.min(5000, Math.ceil(value / 25) * 25); this.lastRise = now; this.cautious = true;
  }
}

export interface ListenerLatency {
  playoutMs: number;
  underruns: number;
  buffering: boolean;
}
