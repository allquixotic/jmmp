// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export interface SoundTouchBufferLike {
  frameCount: number;
}

export interface SoundTouchOutputBufferLike extends SoundTouchBufferLike {
  receiveSamples(output: Float32Array, numFrames: number): void;
}

export interface SoundTouchExtractableOutputBufferLike extends SoundTouchBufferLike {
  extract(output: Float32Array, position: number, numFrames: number): void;
  receive(numFrames: number): void;
}

export interface SoundTouchLike {
  inputBuffer: SoundTouchBufferLike;
  outputBuffer: SoundTouchBufferLike;
  process(): void;
}

export interface SourceFrameCursor {
  sourceFrac: number;
}

const TRANSFORM_EPSILON = 0.000001;

export function hasActiveSoundTouchTransform(
  pitchSemitones: number,
  tempoPct: number,
  ratePct: number,
): boolean {
  return (
    Math.abs(pitchSemitones) > TRANSFORM_EPSILON ||
    Math.abs(tempoPct) > TRANSFORM_EPSILON ||
    Math.abs(ratePct) > TRANSFORM_EPSILON
  );
}

export function soundTouchInputFrameLimit(
  outputFrames: number,
  tempoPct: number,
  ratePct: number,
): number {
  const tempo = Math.max(0.1, 1 + tempoPct / 100);
  const rate = Math.max(0.1, 1 + ratePct / 100);
  return Math.max(outputFrames, Math.ceil(outputFrames * tempo * rate));
}

export function soundTouchInputFrameLimitForRates(
  outputFrames: number,
  tempoPct: number,
  ratePct: number,
  sourceSampleRate: number,
  outputSampleRate: number,
): number {
  return soundTouchInputFrameLimit(
    sourceFramesForOutputFrames(outputFrames, sourceSampleRate, outputSampleRate),
    tempoPct,
    ratePct,
  );
}

export function sourceFramesForOutputFrames(
  outputFrames: number,
  sourceSampleRate: number,
  outputSampleRate: number,
): number {
  if (sourceSampleRate <= 0 || outputSampleRate <= 0) return outputFrames;
  return Math.ceil((outputFrames * sourceSampleRate) / outputSampleRate);
}

export function interpolateSample(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

export function processSoundTouchUntilOutput(
  soundTouch: SoundTouchLike,
  targetFrames: number,
  maxIterations = 8,
): number {
  let iterations = 0;
  while (
    targetFrames > 0 &&
    soundTouch.outputBuffer.frameCount < targetFrames &&
    iterations < maxIterations
  ) {
    const inputBefore = soundTouch.inputBuffer.frameCount;
    const outputBefore = soundTouch.outputBuffer.frameCount;
    soundTouch.process();
    iterations += 1;
    if (
      soundTouch.inputBuffer.frameCount === inputBefore &&
      soundTouch.outputBuffer.frameCount === outputBefore
    ) {
      break;
    }
  }
  return iterations;
}

export function receiveSoundTouchSamples(
  outputBuffer: SoundTouchOutputBufferLike,
  output: Float32Array,
  maxFrames: number,
): number {
  const frames = Math.max(0, Math.min(maxFrames, outputBuffer.frameCount));
  if (frames > 0) outputBuffer.receiveSamples(output, frames);
  return frames;
}

export function receiveResampledSoundTouchSamples(
  outputBuffer: SoundTouchExtractableOutputBufferLike,
  output: Float32Array,
  outputFrames: number,
  sourceSampleRate: number,
  outputSampleRate: number,
  cursor: SourceFrameCursor,
  scratch = new Float32Array(4),
): number {
  const sourceStep =
    outputSampleRate > 0 ? sourceSampleRate / outputSampleRate : 1;
  let got = 0;

  for (let i = 0; i < outputFrames; i++) {
    const available = outputBuffer.frameCount;
    const baseOffset = Math.floor(cursor.sourceFrac);
    if (available <= baseOffset) break;

    const nextOffset = available > baseOffset + 1 ? baseOffset + 1 : baseOffset;
    const readFrames = nextOffset === baseOffset ? 1 : 2;
    const fraction = cursor.sourceFrac - baseOffset;
    outputBuffer.extract(scratch, baseOffset, readFrames);

    const leftA = scratch[0] ?? 0;
    const rightA = scratch[1] ?? 0;
    const leftB = readFrames > 1 ? (scratch[2] ?? leftA) : leftA;
    const rightB = readFrames > 1 ? (scratch[3] ?? rightA) : rightA;

    output[i * 2] = interpolateSample(leftA, leftB, fraction);
    output[i * 2 + 1] = interpolateSample(rightA, rightB, fraction);
    got += 1;

    cursor.sourceFrac += sourceStep;
    const consume = Math.floor(cursor.sourceFrac);
    if (consume > 0) {
      const consumed = Math.min(consume, outputBuffer.frameCount);
      outputBuffer.receive(consumed);
      cursor.sourceFrac -= consumed;
      if (consumed < consume) cursor.sourceFrac = 0;
    }
  }

  return got;
}
