// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// AudioWorkletProcessor that pipes streamed PCM through SoundTouchJS.
// Loaded via audioWorklet.addModule(url) — bundled separately by Vite.
//
// Message protocol (main → worklet):
//   { type: 'config', sampleRate, channels }
//   { type: 'pcm', channels: Float32Array[]; }   // transferable
//   { type: 'params', pitch?, tempo?, rate?, gainDb? }
//   { type: 'flush' }                            // drain output and stop
//   { type: 'end' }                              // upstream EOF
//
// Message protocol (worklet → main):
//   { type: 'buffered', frames }                 // input ring fill level
//   { type: 'drained' }                          // after end + buffer empty

// @ts-expect-error – SoundTouchJS does not ship .d.ts on this version
import { SoundTouch } from "soundtouchjs";
import {
  hasActiveSoundTouchTransform,
  interpolateSample,
  processSoundTouchUntilOutput,
  receiveResampledSoundTouchSamples,
  sourceFramesForOutputFrames,
  soundTouchInputFrameLimitForRates,
  type SourceFrameCursor,
  type SoundTouchExtractableOutputBufferLike,
} from "./soundtouch-process";

const RING_CAPACITY = 8 * 48000; // ~8 seconds at 48k stereo

declare const sampleRate: number; // provided by the AudioWorklet global

class SoundTouchProcessor extends AudioWorkletProcessor {
  private soundTouch: InstanceType<typeof SoundTouch>;
  private inSampleRate = sampleRate;
  private channels = 2;
  private ringLeft = new Float32Array(RING_CAPACITY);
  private ringRight = new Float32Array(RING_CAPACITY);
  private ringHead = 0;
  private ringTail = 0;
  private bufferNotifyTicks = 0;
  private upstreamEnded = false;
  private didNotifyDrained = false;
  private outputSampleRate = sampleRate;
  private directSourceFrac = 0;
  private transformSourceCursor: SourceFrameCursor = { sourceFrac: 0 };
  private transformExtractScratch = new Float32Array(4);
  private epoch = 0;
  private lastPcmSeq = 0;

  private pitch = 0;
  private tempo = 0;
  private rate = 0;
  private gainDb = 0;

  constructor() {
    super();
    this.soundTouch = new SoundTouch(this.inSampleRate);
    this.soundTouch.pitchSemitones = 0;
    this.soundTouch.tempo = 1.0;
    this.soundTouch.rate = 1.0;
    this.configureSoundTouchSampleRate();
    this.port.onmessage = (e: MessageEvent) => this.onMessage(e.data);
  }

  private onMessage(msg: any): void {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "config": {
        if (!this.isCurrentEpoch(msg)) return;
        if (typeof msg.sampleRate === "number" && msg.sampleRate > 0) {
          this.inSampleRate = msg.sampleRate;
          this.configureSoundTouchSampleRate();
        }
        if (msg.channels === 1 || msg.channels === 2) this.channels = msg.channels;
        this.directSourceFrac = 0;
        this.transformSourceCursor.sourceFrac = 0;
        this.upstreamEnded = false;
        this.didNotifyDrained = false;
        break;
      }
      case "pcm": {
        if (!this.isCurrentEpoch(msg)) return;
        const left = msg.channels?.[0] as Float32Array | undefined;
        const right = (msg.channels?.[1] as Float32Array | undefined) ?? left;
        if (!left) return;
        if (typeof msg.seq === "number") this.lastPcmSeq = msg.seq;
        this.enqueue(left, right ?? left);
        break;
      }
      case "params": {
        let transformChanged = false;
        if (typeof msg.pitch === "number") {
          transformChanged ||= msg.pitch !== this.pitch;
          this.pitch = msg.pitch;
          this.soundTouch.pitchSemitones = msg.pitch;
        }
        if (typeof msg.tempo === "number") {
          transformChanged ||= msg.tempo !== this.tempo;
          this.tempo = msg.tempo;
          this.soundTouch.tempo = 1 + msg.tempo / 100;
        }
        if (typeof msg.rate === "number") {
          transformChanged ||= msg.rate !== this.rate;
          this.rate = msg.rate;
          this.soundTouch.rate = 1 + msg.rate / 100;
        }
        if (typeof msg.gainDb === "number") {
          this.gainDb = msg.gainDb;
        }
        if (transformChanged) {
          this.directSourceFrac = 0;
          this.transformSourceCursor.sourceFrac = 0;
          this.soundTouch.clear();
        }
        break;
      }
      case "flush":
      case "end": {
        if (!this.isCurrentEpoch(msg)) return;
        this.upstreamEnded = true;
        break;
      }
      case "reset": {
        if (typeof msg.epoch === "number") this.epoch = msg.epoch;
        this.lastPcmSeq = 0;
        this.ringHead = 0;
        this.ringTail = 0;
        this.directSourceFrac = 0;
        this.transformSourceCursor.sourceFrac = 0;
        this.soundTouch.clear();
        this.upstreamEnded = false;
        this.didNotifyDrained = false;
        this.notifyBuffered();
        this.port.postMessage({ type: "reset", epoch: this.epoch });
        break;
      }
    }
  }

  private isCurrentEpoch(msg: { epoch?: unknown }): boolean {
    return typeof msg.epoch !== "number" || msg.epoch === this.epoch;
  }

  private configureSoundTouchSampleRate(): void {
    const stretch = (this.soundTouch as any).stretch;
    if (stretch && typeof stretch.setParameters === "function") {
      stretch.setParameters(this.inSampleRate, 0, 0, 8);
    }
  }

  private enqueue(left: Float32Array, right: Float32Array): void {
    const n = left.length;
    for (let i = 0; i < n; i++) {
      this.ringLeft[this.ringHead] = left[i]!;
      this.ringRight[this.ringHead] = right[i]!;
      this.ringHead = (this.ringHead + 1) % RING_CAPACITY;
      if (this.ringHead === this.ringTail) {
        // Overflow — drop oldest. Should rarely happen if main thread paces correctly.
        this.ringTail = (this.ringTail + 1) % RING_CAPACITY;
      }
    }
    this.notifyBuffered();
  }

  private ringSize(): number {
    return this.ringHead >= this.ringTail
      ? this.ringHead - this.ringTail
      : RING_CAPACITY - this.ringTail + this.ringHead;
  }

  private feedSoundTouch(maxFrames: number): number {
    const have = this.ringSize();
    const take = Math.min(have, maxFrames);
    if (take === 0) return 0;
    const interleaved = new Float32Array(take * 2);
    for (let i = 0; i < take; i++) {
      interleaved[i * 2] = this.ringLeft[this.ringTail]!;
      interleaved[i * 2 + 1] = this.ringRight[this.ringTail]!;
      this.ringTail = (this.ringTail + 1) % RING_CAPACITY;
    }
    this.soundTouch.inputBuffer.putSamples(interleaved, 0, take);
    return take;
  }

  private notifyBuffered(): void {
    this.port.postMessage({
      type: "buffered",
      epoch: this.epoch,
      ackSeq: this.lastPcmSeq,
      frames: this.ringSize(),
    });
  }

  private fillDirect(
    left: Float32Array,
    right: Float32Array,
    frames: number,
    gain: number,
  ): number {
    const sourceStep =
      this.outputSampleRate > 0 ? this.inSampleRate / this.outputSampleRate : 1;
    let got = 0;
    for (let i = 0; i < frames; i++) {
      const available = this.ringSize();
      const baseOffset = Math.floor(this.directSourceFrac);
      if (available <= baseOffset) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const nextOffset = available > baseOffset + 1 ? baseOffset + 1 : baseOffset;
      const fraction = this.directSourceFrac - baseOffset;
      const leftA = this.ringSample(this.ringLeft, baseOffset);
      const leftB = this.ringSample(this.ringLeft, nextOffset);
      const rightA = this.ringSample(this.ringRight, baseOffset);
      const rightB = this.ringSample(this.ringRight, nextOffset);
      left[i] = interpolateSample(leftA, leftB, fraction) * gain;
      right[i] = interpolateSample(rightA, rightB, fraction) * gain;
      got += 1;

      this.directSourceFrac += sourceStep;
      const consume = Math.floor(this.directSourceFrac);
      if (consume > 0) {
        const consumed = Math.min(consume, this.ringSize());
        this.ringTail = (this.ringTail + consumed) % RING_CAPACITY;
        this.directSourceFrac -= consumed;
        if (consumed < consume) this.directSourceFrac = 0;
      }
    }
    return got;
  }

  private fillTransformed(
    left: Float32Array,
    right: Float32Array,
    frames: number,
    gain: number,
  ): number {
    const interleaved = new Float32Array(frames * 2);
    const got = receiveResampledSoundTouchSamples(
      this.soundTouch.outputBuffer as SoundTouchExtractableOutputBufferLike,
      interleaved,
      frames,
      this.inSampleRate,
      this.outputSampleRate,
      this.transformSourceCursor,
      this.transformExtractScratch,
    );

    for (let i = 0; i < frames; i++) {
      if (i < got) {
        left[i] = interleaved[i * 2]! * gain;
        right[i] = interleaved[i * 2 + 1]! * gain;
      } else {
        left[i] = 0;
        right[i] = 0;
      }
    }

    return got;
  }

  private ringSample(buffer: Float32Array, offset: number): number {
    return buffer[(this.ringTail + offset) % RING_CAPACITY] ?? 0;
  }

  private maybeNotifyDrained(got: number): void {
    if (
      this.upstreamEnded &&
      this.ringSize() === 0 &&
      got === 0 &&
      !this.didNotifyDrained
    ) {
      this.didNotifyDrained = true;
      this.notifyBuffered();
      this.port.postMessage({ type: "drained", epoch: this.epoch });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    const frames = out[0]!.length;
    const gain = this.gainDb === 0 ? 1 : Math.pow(10, this.gainDb / 20);
    const left = out[0]!;
    const right = out[1] ?? out[0]!;

    if (!hasActiveSoundTouchTransform(this.pitch, this.tempo, this.rate)) {
      const got = this.fillDirect(left, right, frames, gain);
      if (got > 0 && ++this.bufferNotifyTicks >= 16) {
        this.bufferNotifyTicks = 0;
        this.notifyBuffered();
      }
      this.maybeNotifyDrained(got);
      return true;
    }

    // Keep SoundTouch fed.
    const fed = this.feedSoundTouch(
      soundTouchInputFrameLimitForRates(
        frames,
        this.tempo,
        this.rate,
        this.inSampleRate,
        this.outputSampleRate,
      ),
    );
    if (fed > 0 && ++this.bufferNotifyTicks >= 16) {
      this.bufferNotifyTicks = 0;
      this.notifyBuffered();
    }

    processSoundTouchUntilOutput(
      this.soundTouch,
      sourceFramesForOutputFrames(frames, this.inSampleRate, this.outputSampleRate),
    );

    const got = this.fillTransformed(left, right, frames, gain);

    this.maybeNotifyDrained(got);

    return true;
  }
}

registerProcessor("soundtouch-processor", SoundTouchProcessor);
