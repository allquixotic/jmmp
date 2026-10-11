// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// Extract embedded album art from the first ~1MB of an audio file.
// Returns { hash, blob, mime } or null if no picture block is present.
//
// Supports: ID3v2 APIC, FLAC METADATA_BLOCK_PICTURE, Ogg comments (base64).

import { putArt } from "./art-cache";

export interface ExtractedArt {
  hash: string;
  mime: string;
  blob: Blob;
}

export async function extractArtFromBytes(
  bytes: Uint8Array,
  codec: "mp3" | "flac" | "vorbis" | "opus"
): Promise<ExtractedArt | null> {
  let result: { mime: string; data: Uint8Array } | null = null;
  try {
    if (codec === "mp3") result = extractMp3Apic(bytes);
    else if (codec === "flac") result = extractFlacPicture(bytes);
    else result = extractOggPicture(bytes);
  } catch {
    return null;
  }
  if (!result) return null;
  const hash = await sha256Hex(result.data);
  const blob = new Blob([new Uint8Array(result.data)], { type: result.mime });
  await putArt(hash, blob);
  return { hash, mime: result.mime, blob };
}

function extractMp3Apic(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const tagSize =
    ((bytes[6]! & 0x7f) << 21) |
    ((bytes[7]! & 0x7f) << 14) |
    ((bytes[8]! & 0x7f) << 7) |
    (bytes[9]! & 0x7f);
  const tag = bytes.subarray(10, 10 + tagSize);
  let i = 0;
  while (i + 10 <= tag.length) {
    const id = String.fromCharCode(tag[i]!, tag[i + 1]!, tag[i + 2]!, tag[i + 3]!);
    const size =
      (tag[i + 4]! << 24) | (tag[i + 5]! << 16) | (tag[i + 6]! << 8) | tag[i + 7]!;
    if (size <= 0 || i + 10 + size > tag.length) break;
    if (id === "APIC") {
      const body = tag.subarray(i + 10, i + 10 + size);
      // text encoding (1 byte), MIME (null-terminated string), picture type (1 byte),
      // description (null-terminated string in indicated encoding), picture data.
      let p = 1;
      const mimeEnd = body.indexOf(0, p);
      if (mimeEnd < 0) return null;
      const mime = new TextDecoder().decode(body.subarray(p, mimeEnd));
      p = mimeEnd + 1 + 1; // skip picture type
      // skip description (terminator depends on encoding 0/3 single null, 1/2 double null)
      const enc = body[0]!;
      if (enc === 1 || enc === 2) {
        while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < body.length && body[p] !== 0) p++;
        p += 1;
      }
      return { mime, data: body.subarray(p) };
    }
    i += 10 + size;
  }
  return null;
}

function extractFlacPicture(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  if (bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    return null;
  }
  let off = 4;
  while (off + 4 <= bytes.length) {
    const header = bytes[off]!;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const size = (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!;
    const body = bytes.subarray(off + 4, off + 4 + size);
    if (type === 6) {
      let p = 4; // picture type
      const mimeLen = readU32(body, p);
      p += 4;
      const mime = new TextDecoder().decode(body.subarray(p, p + mimeLen));
      p += mimeLen;
      const descLen = readU32(body, p);
      p += 4 + descLen + 16; // skip desc, w, h, bpp, colors
      const dataLen = readU32(body, p);
      p += 4;
      return { mime, data: body.subarray(p, p + dataLen) };
    }
    if (last) return null;
    off += 4 + size;
  }
  return null;
}

function extractOggPicture(bytes: Uint8Array): { mime: string; data: Uint8Array } | null {
  // Look for METADATA_BLOCK_PICTURE inside an Ogg comment header.
  // Scan all comment payloads for a base64-encoded FLAC picture block.
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
  // Skip codec-specific comment-header prefix.
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
  const vendorLen = readU32(payload, p);
  p += 4 + vendorLen;
  if (p + 4 > payload.length) return null;
  const count = readU32(payload, p);
  p += 4;
  for (let i = 0; i < count; i++) {
    if (p + 4 > payload.length) return null;
    const len = readU32(payload, p);
    p += 4;
    if (p + len > payload.length) return null;
    const tag = new TextDecoder().decode(payload.subarray(p, p + len));
    p += len;
    const eq = tag.indexOf("=");
    if (eq < 0) continue;
    const key = tag.slice(0, eq).toUpperCase();
    const value = tag.slice(eq + 1);
    if (key === "METADATA_BLOCK_PICTURE") {
      const bin = atob(value);
      const raw = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) raw[j] = bin.charCodeAt(j);
      return extractFlacPictureBody(raw);
    }
  }
  return null;
}

function extractFlacPictureBody(
  body: Uint8Array
): { mime: string; data: Uint8Array } | null {
  let p = 4; // picture type
  const mimeLen = readU32(body, p);
  p += 4;
  const mime = new TextDecoder().decode(body.subarray(p, p + mimeLen));
  p += mimeLen;
  const descLen = readU32(body, p);
  p += 4 + descLen + 16;
  const dataLen = readU32(body, p);
  p += 4;
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  let out = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) out += b[i]!.toString(16).padStart(2, "0");
  return out;
}
