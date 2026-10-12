// Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0
export const BACKGROUND_RESERVE_MS = 1500;

/** Rendering continues independently of main-thread timers. Sample only fresh foreground evidence. */
export class BackgroundPlayout {
  private hidden = false;
  private lastSample: number | undefined;
  private settleUntil = 0;
  private reserveUntil = 0;
  visibility(hidden: boolean, now: number): void {
    this.hidden = hidden;
    this.lastSample = undefined;
    this.settleUntil = now + 1000;
    // Keep the scheduling reserve through foreground settling; it is not learned network jitter.
    this.reserveUntil = now + 10000;
  }
  sample(now: number): boolean {
    const delayed = this.lastSample !== undefined && now - this.lastSample > 1000;
    this.lastSample = now;
    if (delayed) { this.settleUntil = now + 1000; this.reserveUntil = now + 10000; }
    return !this.hidden && !delayed && now >= this.settleUntil;
  }
  canConfirm(observedAt: number, now: number): boolean {
    return !this.hidden && now >= this.settleUntil && now - observedAt <= 1000;
  }
  delay(learned: number, now: number): number {
    return this.hidden || now < this.reserveUntil ? Math.max(learned, BACKGROUND_RESERVE_MS) : learned;
  }
}
