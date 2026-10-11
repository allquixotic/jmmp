// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { AudioDsp } from "@jmmp/shared/audio/dsp";
import { createDecoder } from "@jmmp/shared/audio/decoders";
import { join } from "node:path";

test("V3: shared decoder/DSP in Bun resamples stereo and applies ReplayGain", async () => {
  const decoder = await createDecoder("flac");
  try {
    const chunks = await decoder.decode(new Uint8Array(await Bun.file(join(import.meta.dir, "fixtures/tone.flac")).arrayBuffer()));
    chunks.push(...await decoder.flush());
    const dsp = new AudioDsp(24000); dsp.handle({ type: "params", gainDb: -6.020599913 });
    for (const c of chunks) { dsp.handle({ type: "config", sampleRate: c.sampleRate, channels: c.channels.length }); dsp.handle({ type: "pcm", channels: c.channels }); }
    const left = new Float32Array(2400), right = new Float32Array(2400);
    expect(dsp.process([left, right])).toBe(2400);
    expect(left.every(Number.isFinite)).toBe(true); expect(left).toEqual(right);
    expect(Math.max(...left)).toBeGreaterThan(.04); expect(Math.max(...left)).toBeLessThan(.05);
    expect(dsp.bufferedFrames()).toBe(43200);
  } finally { await decoder.destroy(); }
});

test("V3: pitch/tempo/speed use SoundTouch and reset generations discard old PCM", () => {
  const dsp = new AudioDsp();
  dsp.handle({ type: "pcm", channels: [new Float32Array(20000).fill(.5)] });
  dsp.handle({ type: "params", pitch: 2, tempo: 20, rate: 5 });
  const out = [new Float32Array(960), new Float32Array(960)];
  let produced = 0; for (let i = 0; i < 15; i++) produced += dsp.process(out);
  expect(produced).toBeGreaterThan(5000); expect(out[0]!.every(Number.isFinite)).toBe(true);
  dsp.handle({ type: "reset", epoch: 2 }); dsp.handle({ type: "pcm", epoch: 1, channels: [new Float32Array(500)] });
  expect(dsp.bufferedFrames()).toBe(0);
});
