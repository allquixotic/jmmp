// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { getArtBlob, storeArtBlob } from "../art-store.ts";
import { initDb } from "../db.ts";
import { artReference, extractEmbeddedArt } from "../sources/art.ts";

function syncsafe(size: number): [number, number, number, number] {
  return [
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ];
}

function buildId3v23Apic(image: Uint8Array): Uint8Array {
  const mime = new TextEncoder().encode("image/jpeg");
  const body = new Uint8Array(1 + mime.length + 1 + 1 + 1 + image.length);
  let p = 0;
  body[p++] = 3; // UTF-8
  body.set(mime, p);
  p += mime.length;
  body[p++] = 0;
  body[p++] = 3; // front cover
  body[p++] = 0; // empty description
  body.set(image, p);

  const frame = new Uint8Array(10 + body.length);
  frame[0] = 0x41;
  frame[1] = 0x50;
  frame[2] = 0x49;
  frame[3] = 0x43;
  frame[4] = (body.length >> 24) & 0xff;
  frame[5] = (body.length >> 16) & 0xff;
  frame[6] = (body.length >> 8) & 0xff;
  frame[7] = body.length & 0xff;
  frame.set(body, 10);

  const out = new Uint8Array(10 + frame.length);
  out[0] = 0x49;
  out[1] = 0x44;
  out[2] = 0x33;
  out[3] = 3;
  out[4] = 0;
  out[5] = 0;
  out.set(syncsafe(frame.length), 6);
  out.set(frame, 10);
  return out;
}

describe("embedded art", () => {
  test("extracts APIC image data from ID3v2 MP3 bytes", () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const art = extractEmbeddedArt(buildId3v23Apic(image), "mp3");

    expect(art?.mime).toBe("image/jpeg");
    expect(art?.data).toEqual(image);
    expect(art?.hash).toBe(createHash("sha256").update(image).digest("hex"));
    expect(artReference(art!.hash)).toBe(`/api/art/${art!.hash}`);
  });

  test("stores extracted art blobs in the server database", () => {
    const dir = mkdtempSync(join(tmpdir(), "jmmp-art-test-"));
    try {
      const db = initDb(dir);
      const image = new Uint8Array([1, 2, 3, 4]);
      const art = extractEmbeddedArt(buildId3v23Apic(image), "mp3")!;

      const ref = storeArtBlob(db, art);
      const row = getArtBlob(db, art.hash);

      expect(ref).toBe(`/api/art/${art.hash}`);
      expect(row?.mime).toBe("image/jpeg");
      expect(row?.data).toEqual(image);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
