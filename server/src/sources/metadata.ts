// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Codec } from "@jmmp/shared";

export interface ExtractedMeta {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  durationMs?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  rgTrackDb?: number;
  rgAlbumDb?: number;
}

// Minimal parsers — extract just enough for a useful catalog. Operates on
// the first ~1MB of the file. Returns undefined fields where unsupported.

export async function extractMetadata(
  bytes: Uint8Array,
  codec: Codec,
  fileSize?: number
): Promise<ExtractedMeta> {
  switch (codec) {
    case "mp3":
      return extractMp3(bytes, fileSize);
    case "flac":
      return extractFlac(bytes);
    case "vorbis":
    case "opus":
      return extractOgg(bytes, codec);
  }
}

function extractMp3(bytes: Uint8Array, fileSize?: number): ExtractedMeta {
  const out: ExtractedMeta = {};
  let audioStart = 0;
  if (
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    const tagSize = readSyncsafeU32(bytes, 6);
    const hasFooter = (bytes[5]! & 0x10) !== 0;
    audioStart = Math.min(bytes.length, 10 + tagSize + (hasFooter ? 10 : 0));
    parseId3v2(bytes.subarray(10, 10 + tagSize), out);
  }
  estimateMp3Duration(bytes, fileSize, audioStart, out);
  return out;
}

function parseId3v2(body: Uint8Array, out: ExtractedMeta): void {
  let i = 0;
  while (i + 10 <= body.length) {
    const id = String.fromCharCode(
      body[i]!,
      body[i + 1]!,
      body[i + 2]!,
      body[i + 3]!
    );
    if (id === "\0\0\0\0") break;
    const size =
      (body[i + 4]! << 24) |
      (body[i + 5]! << 16) |
      (body[i + 6]! << 8) |
      body[i + 7]!;
    if (size <= 0 || i + 10 + size > body.length) break;
    const frame = body.subarray(i + 10, i + 10 + size);
    const text = decodeTextFrame(frame);
    switch (id) {
      case "TIT2":
        out.title = text;
        break;
      case "TPE1":
        out.artist = text;
        break;
      case "TPE2":
        out.albumArtist = text;
        break;
      case "TALB":
        out.album = text;
        break;
      case "TYER":
      case "TDRC":
        out.year = parseInt(text, 10) || undefined;
        break;
      case "TRCK":
        out.trackNo = parseInt(text, 10) || undefined;
        break;
      case "TPOS":
        out.discNo = parseInt(text, 10) || undefined;
        break;
      case "TXXX": {
        const split = text.split("\0");
        const key = split[0]?.toUpperCase();
        const val = split[1] ?? "";
        if (key === "REPLAYGAIN_TRACK_GAIN") out.rgTrackDb = parseGainDb(val);
        if (key === "REPLAYGAIN_ALBUM_GAIN") out.rgAlbumDb = parseGainDb(val);
        break;
      }
    }
    i += 10 + size;
  }
}

function decodeTextFrame(frame: Uint8Array): string {
  if (frame.length === 0) return "";
  const enc = frame[0]!;
  const body = frame.subarray(1);
  if (enc === 0) return new TextDecoder("iso-8859-1").decode(body).replace(/\0+$/g, "");
  if (enc === 1 || enc === 2) {
    return new TextDecoder("utf-16").decode(body).replace(/\0+$/g, "");
  }
  return new TextDecoder("utf-8").decode(body).replace(/\0+$/g, "");
}

function parseGainDb(s: string): number | undefined {
  const m = s.match(/-?\d+\.?\d*/);
  return m ? parseFloat(m[0]) : undefined;
}

function estimateMp3Duration(
  bytes: Uint8Array,
  fileSize: number | undefined,
  audioStart: number,
  out: ExtractedMeta
): void {
  const scanEnd = Math.min(bytes.length - 4, audioStart + 200_000);
  for (let i = audioStart; i < scanEnd; i++) {
    const header = readMp3FrameHeader(bytes, i);
    if (!header) continue;
    out.sampleRate = header.sampleRate;
    out.channels = header.channels;

    const vbrDurationMs = mp3VbrDurationMs(bytes, i, header);
    if (vbrDurationMs !== null) {
      out.durationMs = vbrDurationMs;
      return;
    }

    if (fileSize) {
      const audioBytes = Math.max(0, fileSize - i);
      out.durationMs = Math.round((audioBytes * 8) / header.bitrateKbps);
    }
    return;
  }
}

interface Mp3FrameHeader {
  versionBits: number;
  layerBits: number;
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
}

function readMp3FrameHeader(bytes: Uint8Array, i: number): Mp3FrameHeader | null {
  if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xe0) !== 0xe0) return null;
  const versionBits = (bytes[i + 1]! >> 3) & 3;
  const layerBits = (bytes[i + 1]! >> 1) & 3;
  const bitrateIdx = (bytes[i + 2]! >> 4) & 0xf;
  const srIdx = (bytes[i + 2]! >> 2) & 3;
  if (
    versionBits === 1 ||
    layerBits === 0 ||
    bitrateIdx === 0 ||
    bitrateIdx === 0xf ||
    srIdx === 3
  ) {
    return null;
  }
  const bitrateKbps =
    MP3_BITRATES[versionBits === 3 ? 0 : 1]?.[3 - layerBits]?.[bitrateIdx];
  const sampleRate = MP3_SAMPLE_RATES[versionBits]?.[srIdx];
  if (!bitrateKbps || !sampleRate) return null;
  return {
    versionBits,
    layerBits,
    bitrateKbps,
    sampleRate,
    channels: ((bytes[i + 3]! >> 6) & 3) === 3 ? 1 : 2,
    samplesPerFrame: mp3SamplesPerFrame(versionBits, layerBits),
  };
}

function mp3VbrDurationMs(
  bytes: Uint8Array,
  frameStart: number,
  header: Mp3FrameHeader
): number | null {
  const xing = mp3XingFrameCount(bytes, frameStart, header);
  if (xing !== null) return mp3FramesToDurationMs(xing, header);
  const vbri = mp3VbriFrameCount(bytes, frameStart);
  if (vbri !== null) return mp3FramesToDurationMs(vbri, header);
  return null;
}

function mp3XingFrameCount(
  bytes: Uint8Array,
  frameStart: number,
  header: Mp3FrameHeader
): number | null {
  if (header.layerBits !== 1) return null;
  const sideInfoBytes =
    header.versionBits === 3
      ? header.channels === 1
        ? 17
        : 32
      : header.channels === 1
        ? 9
        : 17;
  const tagOffset = frameStart + 4 + sideInfoBytes;
  const tag = ascii(bytes, tagOffset, 4);
  if (tag !== "Xing" && tag !== "Info") return null;
  if (tagOffset + 12 > bytes.length) return null;
  const flags = readU32(bytes, tagOffset + 4);
  if ((flags & 0x01) === 0) return null;
  const frames = readU32(bytes, tagOffset + 8);
  return frames > 0 ? frames : null;
}

function mp3VbriFrameCount(bytes: Uint8Array, frameStart: number): number | null {
  const tagOffset = frameStart + 36;
  if (ascii(bytes, tagOffset, 4) !== "VBRI") return null;
  if (tagOffset + 18 > bytes.length) return null;
  const frames = readU32(bytes, tagOffset + 14);
  return frames > 0 ? frames : null;
}

function mp3FramesToDurationMs(frames: number, header: Mp3FrameHeader): number {
  return Math.round((frames * header.samplesPerFrame * 1000) / header.sampleRate);
}

function mp3SamplesPerFrame(versionBits: number, layerBits: number): number {
  if (layerBits === 3) return 384;
  if (layerBits === 2) return 1152;
  return versionBits === 3 ? 1152 : 576;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readSyncsafeU32(bytes: Uint8Array, off: number): number {
  return (
    ((bytes[off]! & 0x7f) << 21) |
    ((bytes[off + 1]! & 0x7f) << 14) |
    ((bytes[off + 2]! & 0x7f) << 7) |
    (bytes[off + 3]! & 0x7f)
  );
}

function readU32(bytes: Uint8Array, off: number): number {
  return (
    (bytes[off]! << 24) |
    (bytes[off + 1]! << 16) |
    (bytes[off + 2]! << 8) |
    bytes[off + 3]!
  ) >>> 0;
}

const MP3_BITRATES: number[][][] = [
  // MPEG-1
  [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  ],
  // MPEG-2/2.5
  [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  ],
];

const MP3_SAMPLE_RATES: number[][] = [
  [11025, 12000, 8000, 0],
  [0, 0, 0, 0],
  [22050, 24000, 16000, 0],
  [44100, 48000, 32000, 0],
];

function extractFlac(bytes: Uint8Array): ExtractedMeta {
  const out: ExtractedMeta = {};
  if (
    bytes[0] !== 0x66 ||
    bytes[1] !== 0x4c ||
    bytes[2] !== 0x61 ||
    bytes[3] !== 0x43
  ) {
    return out;
  }
  let off = 4;
  while (off + 4 <= bytes.length) {
    const header = bytes[off]!;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const size = (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!;
    const body = bytes.subarray(off + 4, off + 4 + size);
    if (type === 0 && body.length >= 18) {
      out.sampleRate =
        (body[10]! << 12) | (body[11]! << 4) | ((body[12]! >> 4) & 0x0f);
      out.channels = ((body[12]! >> 1) & 0x07) + 1;
      out.bitDepth = (((body[12]! & 0x01) << 4) | ((body[13]! >> 4) & 0x0f)) + 1;
      const samplesHi = body[13]! & 0x0f;
      const samplesMid = body[14]!;
      const samples = samplesHi * Math.pow(2, 32) +
        (samplesMid << 24 >>> 0) +
        (body[15]! << 16) + (body[16]! << 8) + body[17]!;
      if (out.sampleRate) {
        out.durationMs = Math.round((samples / out.sampleRate) * 1000);
      }
    } else if (type === 4) {
      // VORBIS_COMMENT — parse text tags
      parseVorbisComment(body, out);
    }
    if (last) break;
    off += 4 + size;
  }
  return out;
}

function parseVorbisComment(body: Uint8Array, out: ExtractedMeta): void {
  if (body.length < 4) return;
  const vendorLen = u32le(body, 0);
  let p = 4 + vendorLen;
  if (p + 4 > body.length) return;
  const count = u32le(body, p);
  p += 4;
  for (let i = 0; i < count; i++) {
    if (p + 4 > body.length) return;
    const len = u32le(body, p);
    p += 4;
    if (p + len > body.length) return;
    const tag = new TextDecoder().decode(body.subarray(p, p + len));
    p += len;
    const eq = tag.indexOf("=");
    if (eq < 0) continue;
    const key = tag.slice(0, eq).toUpperCase();
    const value = tag.slice(eq + 1);
    switch (key) {
      case "TITLE": out.title = value; break;
      case "ARTIST": out.artist = value; break;
      case "ALBUMARTIST": out.albumArtist = value; break;
      case "ALBUM": out.album = value; break;
      case "DATE":
      case "YEAR":
        out.year = parseInt(value, 10) || out.year;
        break;
      case "TRACKNUMBER": out.trackNo = parseInt(value, 10) || undefined; break;
      case "DISCNUMBER": out.discNo = parseInt(value, 10) || undefined; break;
      case "REPLAYGAIN_TRACK_GAIN": out.rgTrackDb = parseGainDb(value); break;
      case "REPLAYGAIN_ALBUM_GAIN": out.rgAlbumDb = parseGainDb(value); break;
    }
  }
}

function u32le(bytes: Uint8Array, off: number): number {
  return (
    bytes[off]! |
    (bytes[off + 1]! << 8) |
    (bytes[off + 2]! << 16) |
    (bytes[off + 3]! << 24)
  ) >>> 0;
}

function extractOgg(bytes: Uint8Array, codec: Codec): ExtractedMeta {
  const out: ExtractedMeta = {};
  // Find pages, locate the comment header.
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
    if (codec === "vorbis" && payload[0] === 0x03 && payload.subarray(1, 7).every((b, i) => b === [0x76, 0x6f, 0x72, 0x62, 0x69, 0x73][i])) {
      parseVorbisComment(payload.subarray(7), out);
    } else if (codec === "opus" && startsWith(payload, [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73])) {
      parseVorbisComment(payload.subarray(8), out);
    } else if (codec === "vorbis" && payload[0] === 0x01 && payload.subarray(1, 7).every((b, i) => b === [0x76, 0x6f, 0x72, 0x62, 0x69, 0x73][i])) {
      // Identification header: channels at byte 11, sample rate u32le at byte 12
      out.channels = payload[11];
      out.sampleRate = u32le(payload, 12);
    } else if (codec === "opus" && startsWith(payload, [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64])) {
      out.channels = payload[9];
      out.sampleRate = 48000;
    }
    off += 27 + segments + pageSize;
  }
  return out;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}
