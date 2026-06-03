// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { extractMetadata } from "../sources/metadata.ts";

function buildId3v2(frames: Array<{ id: string; text: string }>): Uint8Array {
  const enc = new TextEncoder();
  return buildId3v23Raw(
    frames.map((f) => {
      const body = enc.encode("" + f.text);
      return { id: f.id, body };
    })
  );
}

function buildId3v23Raw(frames: Array<{ id: string; body: Uint8Array }>): Uint8Array {
  const frameBuffers: Uint8Array[] = [];
  for (const f of frames) {
    const size = f.body.length;
    const head = new Uint8Array(10);
    head[0] = f.id.charCodeAt(0);
    head[1] = f.id.charCodeAt(1);
    head[2] = f.id.charCodeAt(2);
    head[3] = f.id.charCodeAt(3);
    head[4] = (size >> 24) & 0xff;
    head[5] = (size >> 16) & 0xff;
    head[6] = (size >> 8) & 0xff;
    head[7] = size & 0xff;
    const out = new Uint8Array(head.length + f.body.length);
    out.set(head, 0);
    out.set(f.body, head.length);
    frameBuffers.push(out);
  }
  const totalFrames = frameBuffers.reduce((s, f) => s + f.length, 0);
  const header = new Uint8Array(10);
  header[0] = 0x49;
  header[1] = 0x44;
  header[2] = 0x33;
  header[3] = 3;
  header[4] = 0;
  header[5] = 0;
  header[6] = ((totalFrames >> 21) & 0x7f) | 0;
  header[7] = ((totalFrames >> 14) & 0x7f) | 0;
  header[8] = ((totalFrames >> 7) & 0x7f) | 0;
  header[9] = totalFrames & 0x7f;
  const out = new Uint8Array(header.length + totalFrames);
  out.set(header, 0);
  let off = header.length;
  for (const f of frameBuffers) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

function buildApicBody(image: Uint8Array): Uint8Array {
  const mime = new TextEncoder().encode("image/jpeg");
  const body = new Uint8Array(1 + mime.length + 1 + 1 + 1 + image.length);
  let p = 0;
  body[p++] = 3;
  body.set(mime, p);
  p += mime.length;
  body[p++] = 0;
  body[p++] = 3;
  body[p++] = 0;
  body.set(image, p);
  return body;
}

describe("metadata", () => {
  test("ID3v2 text frames parse", async () => {
    const bytes = buildId3v2([
      { id: "TIT2", text: "Hey Jude" },
      { id: "TPE1", text: "The Beatles" },
      { id: "TALB", text: "Singles" },
      { id: "TYER", text: "1968" },
    ]);
    const meta = await extractMetadata(bytes, "mp3");
    expect(meta.title).toBe("Hey Jude");
    expect(meta.artist).toBe("The Beatles");
    expect(meta.album).toBe("Singles");
    expect(meta.year).toBe(1968);
  });

  test("MP3 duration skips embedded APIC image bytes and uses the real audio frame", async () => {
    const falseMpegSyncInJpeg = new Uint8Array([0xff, 0xfa, 0x64, 0x00]);
    const id3 = buildId3v23Raw([
      { id: "APIC", body: buildApicBody(falseMpegSyncInJpeg) },
    ]);
    const firstAudioFrame = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0]);
    const bytes = new Uint8Array(id3.length + firstAudioFrame.length);
    bytes.set(id3, 0);
    bytes.set(firstAudioFrame, id3.length);

    const meta = await extractMetadata(bytes, "mp3", id3.length + 2_880_000);

    expect(meta.sampleRate).toBe(44100);
    expect(meta.channels).toBe(2);
    expect(meta.durationMs).toBe(180_000);
  });

  test("MP3 duration prefers Xing frame counts for VBR files", async () => {
    const id3 = buildId3v2([{ id: "TIT2", text: "VBR Song" }]);
    const frame = new Uint8Array(160);
    frame[0] = 0xff;
    frame[1] = 0xfb;
    frame[2] = 0x50; // MPEG-1 layer III, 64 kbps, 44.1 kHz
    frame[3] = 0x40; // stereo, so Xing starts after 32 side-info bytes
    const xingOffset = 4 + 32;
    frame.set(new TextEncoder().encode("Xing"), xingOffset);
    frame[xingOffset + 7] = 1; // frames flag
    const frames = 6891;
    frame[xingOffset + 8] = (frames >> 24) & 0xff;
    frame[xingOffset + 9] = (frames >> 16) & 0xff;
    frame[xingOffset + 10] = (frames >> 8) & 0xff;
    frame[xingOffset + 11] = frames & 0xff;
    const bytes = new Uint8Array(id3.length + frame.length);
    bytes.set(id3, 0);
    bytes.set(frame, id3.length);

    const meta = await extractMetadata(bytes, "mp3", id3.length + 2_880_000);

    expect(meta.sampleRate).toBe(44100);
    expect(meta.durationMs).toBeGreaterThan(179_900);
    expect(meta.durationMs).toBeLessThan(180_100);
  });

  test("non-audio bytes return empty meta", async () => {
    const meta = await extractMetadata(new Uint8Array(64), "mp3");
    expect(meta.title).toBeUndefined();
  });
});
