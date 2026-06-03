// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// Main-thread wrapper around the SoundTouch AudioWorklet.

export interface SoundTouchParams {
  pitchSemi?: number;
  tempoPct?: number;
  speedPct?: number;
  gainDb?: number;
}

export interface BufferedFrameReport {
  epoch: number;
  frames: number;
  ackSeq?: number;
}

export class WorkletBufferTracker {
  private epoch = 0;
  private nextSeq = 0;
  private workletFrames = 0;
  private pendingFrames = new Map<number, number>();

  get currentEpoch(): number {
    return this.epoch;
  }

  get bufferedFrames(): number {
    let pending = 0;
    for (const frames of this.pendingFrames.values()) pending += frames;
    return this.workletFrames + pending;
  }

  reset(): number {
    this.epoch++;
    this.nextSeq = 0;
    this.workletFrames = 0;
    this.pendingFrames.clear();
    return this.epoch;
  }

  enqueue(frames: number): { epoch: number; seq: number } {
    const seq = ++this.nextSeq;
    this.pendingFrames.set(seq, frames);
    return { epoch: this.epoch, seq };
  }

  acknowledge(report: BufferedFrameReport): boolean {
    if (report.epoch !== this.epoch) return false;
    if (typeof report.ackSeq === "number") {
      for (const seq of [...this.pendingFrames.keys()]) {
        if (seq <= report.ackSeq) this.pendingFrames.delete(seq);
      }
    }
    this.workletFrames = report.frames;
    return true;
  }
}

let modulePromise: Promise<void> | null = null;
let workletUrlPromise: Promise<string> | null = null;

async function ensureModule(audioContext: AudioContext): Promise<void> {
  if (!modulePromise) {
    modulePromise = loadWorkletUrl().then((url) => audioContext.audioWorklet.addModule(url));
  }
  await modulePromise;
}

async function loadWorkletUrl(): Promise<string> {
  if (!workletUrlPromise) {
    workletUrlPromise = import("./soundtouch-worklet.ts?worker&url").then(
      (module) => module.default as string
    );
  }
  return workletUrlPromise;
}

export class SoundTouchNode extends EventTarget {
  readonly node: AudioWorkletNode;
  private drainedResolvers: Array<() => void> = [];
  private resetResolvers: Array<() => void> = [];
  private bufferTracker = new WorkletBufferTracker();
  private bufferedWaiters: Array<{ maxFrames: number; resolve: () => void }> = [];

  private constructor(audioContext: AudioContext) {
    super();
    this.node = new AudioWorkletNode(audioContext, "soundtouch-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.port.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type === "drained") {
        if (!this.isCurrentEpoch(msg)) return;
        const r = this.drainedResolvers.splice(0);
        for (const fn of r) fn();
        this.dispatchEvent(new Event("drained"));
      }
      if (msg?.type === "reset") {
        if (!this.isCurrentEpoch(msg)) return;
        const r = this.resetResolvers.splice(0);
        for (const fn of r) fn();
      }
      if (msg?.type === "buffered" && typeof msg.frames === "number") {
        if (!this.bufferTracker.acknowledge(msg as BufferedFrameReport)) return;
        this.resolveBufferedWaiters();
      }
    };
  }

  static async create(audioContext: AudioContext): Promise<SoundTouchNode> {
    await ensureModule(audioContext);
    return new SoundTouchNode(audioContext);
  }

  configure(sampleRate: number, channels: number): void {
    this.node.port.postMessage({
      type: "config",
      epoch: this.bufferTracker.currentEpoch,
      sampleRate,
      channels,
    });
  }

  pushPcm(channels: Float32Array[]): void {
    const frames = channels[0]?.length ?? 0;
    const queued = this.bufferTracker.enqueue(frames);
    const transfer = channels.map((c) => c.buffer);
    this.node.port.postMessage(
      { type: "pcm", epoch: queued.epoch, seq: queued.seq, channels },
      transfer
    );
  }

  setParams(p: SoundTouchParams): void {
    this.node.port.postMessage({
      type: "params",
      pitch: p.pitchSemi,
      tempo: p.tempoPct,
      rate: p.speedPct,
      gainDb: p.gainDb,
    });
  }

  flush(): void {
    this.node.port.postMessage({ type: "flush" });
  }

  end(): void {
    this.node.port.postMessage({
      type: "end",
      epoch: this.bufferTracker.currentEpoch,
    });
  }

  reset(): void {
    const epoch = this.bufferTracker.reset();
    this.resolveBufferedWaiters();
    this.node.port.postMessage({ type: "reset", epoch });
  }

  async resetAndWait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    const epoch = this.bufferTracker.reset();
    this.resolveBufferedWaiters();
    await new Promise<void>((resolve) => {
      let active = true;
      const finish = () => {
        if (!active) return;
        active = false;
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      this.resetResolvers.push(finish);
      signal?.addEventListener("abort", finish, { once: true });
      this.node.port.postMessage({ type: "reset", epoch });
    });
  }

  async waitDrained(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    return new Promise((resolve) => {
      let active = true;
      const finish = () => {
        if (!active) return;
        active = false;
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      this.drainedResolvers.push(finish);
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  async waitForBufferedBelow(maxFrames: number, signal?: AbortSignal): Promise<void> {
    if (this.bufferTracker.bufferedFrames <= maxFrames || signal?.aborted) return;
    return new Promise((resolve) => {
      let active = true;
      const finish = () => {
        if (!active) return;
        active = false;
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      this.bufferedWaiters.push({ maxFrames, resolve: finish });
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  disconnect(): void {
    this.node.disconnect();
  }

  private resolveBufferedWaiters(): void {
    const pending = this.bufferedWaiters.splice(0);
    for (const waiter of pending) {
      if (this.bufferTracker.bufferedFrames <= waiter.maxFrames) {
        waiter.resolve();
      } else {
        this.bufferedWaiters.push(waiter);
      }
    }
  }

  private isCurrentEpoch(msg: { epoch?: unknown }): boolean {
    return (
      typeof msg.epoch !== "number" ||
      msg.epoch === this.bufferTracker.currentEpoch
    );
  }
}
