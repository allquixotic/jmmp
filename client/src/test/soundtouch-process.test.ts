// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

import {
  hasActiveSoundTouchTransform,
  interpolateSample,
  processSoundTouchUntilOutput,
  receiveResampledSoundTouchSamples,
  receiveSoundTouchSamples,
  sourceFramesForOutputFrames,
  soundTouchInputFrameLimit,
  soundTouchInputFrameLimitForRates,
  type SoundTouchLike,
  type SoundTouchExtractableOutputBufferLike,
  type SoundTouchOutputBufferLike,
} from "../audio/soundtouch-process";

function fakeSoundTouch(inputFrames: number, outputFrames: number): SoundTouchLike & {
  processCalls: number;
} {
  return {
    inputBuffer: { frameCount: inputFrames },
    outputBuffer: { frameCount: outputFrames },
    processCalls: 0,
    process() {
      this.processCalls += 1;
      const moved = Math.min(128, this.inputBuffer.frameCount);
      this.inputBuffer.frameCount -= moved;
      this.outputBuffer.frameCount += moved;
    },
  };
}

describe("processSoundTouchUntilOutput", () => {
  test("runs the SoundTouch processor until enough output frames are available", () => {
    const soundTouch = fakeSoundTouch(512, 0);

    const iterations = processSoundTouchUntilOutput(soundTouch, 256);

    expect(iterations).toBe(2);
    expect(soundTouch.processCalls).toBe(2);
    expect(soundTouch.inputBuffer.frameCount).toBe(256);
    expect(soundTouch.outputBuffer.frameCount).toBe(256);
  });

  test("stops when SoundTouch cannot make progress yet", () => {
    const soundTouch: SoundTouchLike & { processCalls: number } = {
      inputBuffer: { frameCount: 64 },
      outputBuffer: { frameCount: 0 },
      processCalls: 0,
      process() {
        this.processCalls += 1;
      },
    };

    const iterations = processSoundTouchUntilOutput(soundTouch, 128);

    expect(iterations).toBe(1);
    expect(soundTouch.processCalls).toBe(1);
    expect(soundTouch.inputBuffer.frameCount).toBe(64);
    expect(soundTouch.outputBuffer.frameCount).toBe(0);
  });

  test("lets SoundTouch flush output even when its public input buffer is empty", () => {
    const soundTouch: SoundTouchLike & { processCalls: number } = {
      inputBuffer: { frameCount: 0 },
      outputBuffer: { frameCount: 0 },
      processCalls: 0,
      process() {
        this.processCalls += 1;
        this.outputBuffer.frameCount += 128;
      },
    };

    const iterations = processSoundTouchUntilOutput(soundTouch, 128);

    expect(iterations).toBe(1);
    expect(soundTouch.processCalls).toBe(1);
    expect(soundTouch.outputBuffer.frameCount).toBe(128);
  });
});

describe("SoundTouch routing", () => {
  test("bypasses SoundTouch for identity pitch, tempo, and speed", () => {
    expect(hasActiveSoundTouchTransform(0, 0, 0)).toBe(false);
    expect(hasActiveSoundTouchTransform(0.0000001, 0, 0)).toBe(false);
    expect(hasActiveSoundTouchTransform(0.1, 0, 0)).toBe(true);
    expect(hasActiveSoundTouchTransform(0, 0.1, 0)).toBe(true);
    expect(hasActiveSoundTouchTransform(0, 0, 0.1)).toBe(true);
  });

  test("paces active transforms from the requested tempo and rate", () => {
    expect(soundTouchInputFrameLimit(128, 0, 0)).toBe(128);
    expect(soundTouchInputFrameLimit(128, 50, 0)).toBe(192);
    expect(soundTouchInputFrameLimit(128, 0, 50)).toBe(192);
    expect(soundTouchInputFrameLimit(128, 50, 50)).toBe(288);
    expect(soundTouchInputFrameLimit(128, -90, -90)).toBe(128);
  });

  test("paces active transforms in source-rate frames", () => {
    expect(soundTouchInputFrameLimitForRates(128, 0, 0, 192_000, 48_000)).toBe(
      512,
    );
    expect(soundTouchInputFrameLimitForRates(128, 0, 0, 44_100, 48_000)).toBe(
      118,
    );
    expect(soundTouchInputFrameLimitForRates(128, 50, 0, 192_000, 48_000)).toBe(
      768,
    );
  });

  test("converts output frame counts back to source frame counts", () => {
    expect(sourceFramesForOutputFrames(48_000, 96_000, 48_000)).toBe(96_000);
    expect(sourceFramesForOutputFrames(48_000, 44_100, 48_000)).toBe(44_100);
    expect(sourceFramesForOutputFrames(44_100, 48_000, 44_100)).toBe(48_000);
  });

  test("interpolates between source samples", () => {
    expect(interpolateSample(0, 10, 0)).toBe(0);
    expect(interpolateSample(0, 10, 0.25)).toBe(2.5);
    expect(interpolateSample(0, 10, 1)).toBe(10);
  });
});

function fakeExtractableOutputBuffer(
  frames: number[],
): SoundTouchExtractableOutputBufferLike & { offset: number } {
  const interleaved = new Float32Array(frames.length * 2);
  for (let i = 0; i < frames.length; i++) {
    interleaved[i * 2] = frames[i]!;
    interleaved[i * 2 + 1] = -frames[i]!;
  }

  return {
    frameCount: frames.length,
    offset: 0,
    extract(output, position, numFrames) {
      const start = (this.offset + position) * 2;
      output.set(interleaved.subarray(start, start + numFrames * 2));
    },
    receive(numFrames) {
      const received = Math.min(numFrames, this.frameCount);
      this.offset += received;
      this.frameCount -= received;
    },
  };
}

describe("receiveResampledSoundTouchSamples", () => {
  test("resamples transformed 192 kHz source frames for a 48 kHz output device", () => {
    const outputBuffer = fakeExtractableOutputBuffer([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    const output = new Float32Array(8);
    const cursor = { sourceFrac: 0 };

    const got = receiveResampledSoundTouchSamples(
      outputBuffer,
      output,
      4,
      192_000,
      48_000,
      cursor,
    );

    expect(got).toBe(4);
    expect(Array.from(output)).toEqual([0, -0, 4, -4, 8, -8, 12, -12]);
    expect(outputBuffer.offset).toBe(16);
    expect(cursor.sourceFrac).toBe(0);
  });

  test("interpolates when transformed source frames are below output rate", () => {
    const outputBuffer = fakeExtractableOutputBuffer([0, 10, 20]);
    const output = new Float32Array(6);
    const cursor = { sourceFrac: 0 };

    const got = receiveResampledSoundTouchSamples(
      outputBuffer,
      output,
      3,
      24_000,
      48_000,
      cursor,
    );

    expect(got).toBe(3);
    expect(Array.from(output)).toEqual([0, -0, 5, -5, 10, -10]);
    expect(outputBuffer.offset).toBe(1);
    expect(cursor.sourceFrac).toBe(0.5);
  });
});

describe("receiveSoundTouchSamples", () => {
  test("returns the frame count because SoundTouchJS receiveSamples is void", () => {
    const received: number[] = [];
    const outputBuffer: SoundTouchOutputBufferLike = {
      frameCount: 64,
      receiveSamples(output, numFrames) {
        received.push(numFrames);
        output[0] = 0.25;
      },
    };
    const output = new Float32Array(256);

    const got = receiveSoundTouchSamples(outputBuffer, output, 128);

    expect(got).toBe(64);
    expect(received).toEqual([64]);
    expect(output[0]).toBe(0.25);
  });

  test("receives non-silent frames from the real SoundTouchJS package", async () => {
    // @ts-expect-error SoundTouchJS does not ship .d.ts on this version.
    const { SoundTouch } = await import("soundtouchjs");
    const soundTouch = new SoundTouch();
    const inputFrames = 48_000;
    const input = new Float32Array(inputFrames * 2);
    for (let i = 0; i < inputFrames; i++) {
      const sample = Math.sin(i / 10);
      input[i * 2] = sample;
      input[i * 2 + 1] = sample;
    }

    soundTouch.inputBuffer.putSamples(input, 0, inputFrames);
    const iterations = processSoundTouchUntilOutput(soundTouch, 128);
    const output = new Float32Array(256);
    const got = receiveSoundTouchSamples(soundTouch.outputBuffer, output, 128);

    expect(iterations).toBeGreaterThan(0);
    expect(got).toBeGreaterThan(0);
    expect(output.some((sample) => sample !== 0)).toBe(true);
  });
});
