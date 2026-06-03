// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Codec } from "@jmmp/shared";

export interface ExtractedArt {
  hash: string;
  mime: string;
  data: Uint8Array;
}

export function artReference(hash: string): string {
  return `/api/art/${encodeURIComponent(hash)}`;
}

export function extractEmbeddedArt(bytes: Uint8Array, codec: Codec): ExtractedArt | null {
  let result: { mime: string; data: Uint8Array } | null = null;
  try {
    if (codec === "mp3") result = extractMp3Apic(bytes);
    else if (codec === "flac") result = extractFlacPicture(bytes);
    else result = extractOggPicture(bytes);
  } catch {
    return null;
  }
  if (!result || result.data.length === 0) return null;
  return {
    hash: createHash("sha256").update(result.data).digest("hex"),
    mime: result.mime || "application/octet-stream",
    data: result.data,
  };
}

function extractMp3Apic(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const majorVersion = bytes[3]!;
  const tagSize = readSyncsafeU32(bytes, 6);
  const tag = bytes.subarray(10, 10 + tagSize);
  let i = 0;
  while (i + 10 <= tag.length) {
    const id = String.fromCharCode(tag[i]!, tag[i + 1]!, tag[i + 2]!, tag[i + 3]!);
    if (id === "\0\0\0\0") break;
    const size = majorVersion >= 4 ? readSyncsafeU32(tag, i + 4) : readU32(tag, i + 4);
    if (size <= 0 || i + 10 + size > tag.length) break;
    if (id === "APIC") {
      return extractApicBody(tag.subarray(i + 10, i + 10 + size));
    }
    i += 10 + size;
  }
  return null;
}

function extractApicBody(body: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (body.length < 4) return null;
  const enc = body[0]!;
  let p = 1;
  const mimeEnd = body.indexOf(0, p);
  if (mimeEnd < 0) return null;
  const mime = new TextDecoder().decode(body.subarray(p, mimeEnd));
  p = mimeEnd + 2; // null terminator + picture type
  if (enc === 1 || enc === 2) {
    while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < body.length && body[p] !== 0) p++;
    p += 1;
  }
  if (p >= body.length) return null;
  return { mime, data: body.subarray(p) };
}

function extractFlacPicture(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (
    bytes[0] !== 0x66 ||
    bytes[1] !== 0x4c ||
    bytes[2] !== 0x61 ||
    bytes[3] !== 0x43
  ) {
    return null;
  }
  let off = 4;
  while (off + 4 <= bytes.length) {
    const header = bytes[off]!;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const size = (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!;
    const body = bytes.subarray(off + 4, off + 4 + size);
    if (type === 6) return extractFlacPictureBody(body);
    if (last) return null;
    off += 4 + size;
  }
  return null;
}

function extractOggPicture(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  let off = 0;
  while (off + 27 <= bytes.length) {
    if (
      bytes[off] !== 0x4f ||
      bytes[off + 1] !== 0x67 ||
      bytes[off + 2] !== 0x67 ||
      bytes[off + 3] !== 0x53
    ) {
      break;
    }
    const segments = bytes[off + 26]!;
    if (off + 27 + segments > bytes.length) break;
    let pageSize = 0;
    for (let i = 0; i < segments; i++) pageSize += bytes[off + 27 + i]!;
    const payload = bytes.subarray(off + 27 + segments, off + 27 + segments + pageSize);
    const found = findPictureBlockInComment(payload);
    if (found) return found;
    off += 27 + segments + pageSize;
  }
  return null;
}

function findPictureBlockInComment(
  payload: Uint8Array
): { mime: string; data: Uint8Array } | null {
  let start = 0;
  if (
    payload.length >= 7 &&
    payload[0] === 0x03 &&
    payload[1] === 0x76 &&
    payload[2] === 0x6f &&
    payload[3] === 0x72 &&
    payload[4] === 0x62 &&
    payload[5] === 0x69 &&
    payload[6] === 0x73
  ) {
    start = 7;
  } else if (
    payload.length >= 8 &&
    payload[0] === 0x4f &&
    payload[1] === 0x70 &&
    payload[2] === 0x75 &&
    payload[3] === 0x73 &&
    payload[4] === 0x54 &&
    payload[5] === 0x61 &&
    payload[6] === 0x67 &&
    payload[7] === 0x73
  ) {
    start = 8;
  } else {
    return null;
  }
  let p = start;
  if (p + 4 > payload.length) return null;
  const vendorLen = readU32Le(payload, p);
  p += 4 + vendorLen;
  if (p + 4 > payload.length) return null;
  const count = readU32Le(payload, p);
  p += 4;
  for (let i = 0; i < count; i++) {
    if (p + 4 > payload.length) return null;
    const len = readU32Le(payload, p);
    p += 4;
    if (p + len > payload.length) return null;
    const tag = new TextDecoder().decode(payload.subarray(p, p + len));
    p += len;
    const eq = tag.indexOf("=");
    if (eq < 0) continue;
    if (tag.slice(0, eq).toUpperCase() !== "METADATA_BLOCK_PICTURE") continue;
    const raw = new Uint8Array(Buffer.from(tag.slice(eq + 1), "base64"));
    return extractFlacPictureBody(raw);
  }
  return null;
}

function extractFlacPictureBody(body: Uint8Array): { mime: string; data: Uint8Array } | null {
  let p = 4; // picture type
  const mimeLen = readU32(body, p);
  p += 4;
  if (p + mimeLen > body.length) return null;
  const mime = new TextDecoder().decode(body.subarray(p, p + mimeLen));
  p += mimeLen;
  const descLen = readU32(body, p);
  p += 4 + descLen + 16;
  const dataLen = readU32(body, p);
  p += 4;
  if (p + dataLen > body.length) return null;
  return { mime, data: body.subarray(p, p + dataLen) };
}

function readU32(bytes: Uint8Array, off: number): number {
  return (
    (bytes[off]! << 24) |
    (bytes[off + 1]! << 16) |
    (bytes[off + 2]! << 8) |
    bytes[off + 3]!
  ) >>> 0;
}

function readSyncsafeU32(bytes: Uint8Array, off: number): number {
  return (
    ((bytes[off]! & 0x7f) << 21) |
    ((bytes[off + 1]! & 0x7f) << 14) |
    ((bytes[off + 2]! & 0x7f) << 7) |
    (bytes[off + 3]! & 0x7f)
  );
}

function readU32Le(bytes: Uint8Array, off: number): number {
  return (
    bytes[off]! |
    (bytes[off + 1]! << 8) |
    (bytes[off + 2]! << 16) |
    (bytes[off + 3]! << 24)
  ) >>> 0;
}
