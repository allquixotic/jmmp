// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export type Codec = "mp3" | "flac" | "vorbis" | "opus";

export const SUPPORTED_CODECS: readonly Codec[] = ["mp3", "flac", "vorbis", "opus"] as const;

export type CodecMime =
  | "audio/mpeg"
  | "audio/flac"
  | "audio/x-flac"
  | "audio/ogg"
  | "audio/opus"
  | "audio/vorbis";

const EXT_TO_CODEC: Record<string, Codec> = {
  mp3: "mp3",
  flac: "flac",
  ogg: "vorbis",
  oga: "vorbis",
  opus: "opus",
};

export function codecFromExtension(filename: string): Codec | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_CODEC[ext] ?? null;
}

export function codecFromMime(mime: string): Codec | null {
  const lower = mime.toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("flac")) return "flac";
  if (lower.includes("opus")) return "opus";
  if (lower.includes("vorbis") || lower === "audio/ogg") return "vorbis";
  return null;
}
