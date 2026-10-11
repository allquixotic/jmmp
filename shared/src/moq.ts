// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
export interface MoqSettings {
  enabled: boolean;
  bind: string;
  port: number;
  publicUrl: string;
  certPath: string;
  keyPath: string;
  bitrate: number;
  /** TLS terminates at a reverse proxy; the embedded relay uses loopback HTTP. */
  tlsOffload?: boolean;
  /** Optional managed relay URL (may include a subscribe-only token in its path). */
  webtransportUrl?: string;
  /** Independent fallback, for example a WebSocket endpoint through a tunnel. */
  websocketUrl?: string;
  publicListening?: boolean;
}
export const DEFAULT_MOQ_SETTINGS: MoqSettings = {
  enabled: false, bind: "127.0.0.1", port: 4443,
  publicUrl: "http://localhost:4443", certPath: "", keyPath: "", bitrate: 192000,
};
export function validateMoqSettings(value: unknown): MoqSettings {
  if (!value || typeof value !== "object") throw new Error("MoQ settings required");
  const s = { ...DEFAULT_MOQ_SETTINGS, ...value } as MoqSettings;
  if (typeof s.enabled !== "boolean") throw new Error("Invalid enabled flag");
  if (!Number.isInteger(s.port) || s.port < 1024 || s.port > 65535) throw new Error("Relay port must be 1024–65535");
  if (typeof s.bind !== "string" || !/^[\da-fA-F:.]+$/.test(s.bind)) throw new Error("Relay bind must be an IP address");
  if (!Number.isInteger(s.bitrate) || s.bitrate < 32000 || s.bitrate > 320000) throw new Error("Opus bitrate must be 32000–320000");
  if (typeof s.publicUrl !== "string") throw new Error("Relay URL required");
  const url = new URL(s.publicUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Relay URL must be an HTTP(S) origin");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Remote listeners require HTTPS");
  if (typeof s.certPath !== "string" || typeof s.keyPath !== "string" || !!s.certPath !== !!s.keyPath) throw new Error("Provide both TLS certificate and key paths");
  for (const key of ["tlsOffload", "publicListening"] as const) {
    if (s[key] !== undefined && typeof s[key] !== "boolean") throw new Error(`Invalid ${key}`);
  }
  if (s.tlsOffload && !["127.0.0.1", "::1"].includes(s.bind)) throw new Error("TLS offload requires a loopback relay bind");
  if (url.protocol === "https:" && !s.certPath && !s.tlsOffload) throw new Error("HTTPS requires TLS certificate and key paths on the server, or TLS offload");
  for (const [key, protocols] of [["webtransportUrl", ["https:"]], ["websocketUrl", ["wss:", "https:"]]] as const) {
    if (s[key] !== undefined && typeof s[key] !== "string") throw new Error(`Invalid ${key}`);
    if (s[key]) {
      const endpoint = new URL(s[key]);
      const localWebSocket = key === "websocketUrl" && ["ws:", "http:"].includes(endpoint.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
      if ((!protocols.includes(endpoint.protocol as never) && !localWebSocket) || endpoint.username || endpoint.password || endpoint.hash) throw new Error(`Invalid ${key}`);
    }
  }
  return { enabled: s.enabled, bind: s.bind, port: s.port, publicUrl: url.origin,
    certPath: s.certPath, keyPath: s.keyPath, bitrate: s.bitrate,
    ...(s.tlsOffload === undefined ? {} : { tlsOffload: s.tlsOffload }),
    ...(s.publicListening === undefined ? {} : { publicListening: s.publicListening }),
    ...(s.webtransportUrl ? { webtransportUrl: s.webtransportUrl } : {}),
    ...(s.websocketUrl ? { websocketUrl: s.websocketUrl } : {}) };
}
export interface DspParams {
  pitchSemi: number; tempoPct: number; speedPct: number; gainDb: number; volume: number;
}
export const DEFAULT_DSP_PARAMS: DspParams = { pitchSemi: 0, tempoPct: 0, speedPct: 0, gainDb: 0, volume: 1 };
export function validateDspParams(value: Partial<DspParams>): DspParams {
  const s = { ...DEFAULT_DSP_PARAMS, ...value };
  for (const [key, min, max] of [["pitchSemi", -5, 5], ["tempoPct", -50, 100], ["speedPct", -50, 100], ["gainDb", -60, 24], ["volume", 0, 1]] as const) {
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw new Error(`Invalid ${key}`);
  }
  return s;
}
export interface PlaybackStatus {
  instanceId?: string;
  revision: number; generation: number; trackId: number | null;
  position: number; duration: number;
  state: "idle" | "buffering" | "playing" | "paused" | "ended" | "error";
  params: DspParams; error: string | null;
}
export interface NowPlayingTrack { title: string | null; artist: string | null }
export interface ListenerPlaybackStatus extends PlaybackStatus { nowPlaying: NowPlayingTrack | null }
export type PlaybackCommand =
  | { type: "play"; trackId: number; position?: number; paused?: boolean; params?: Partial<DspParams> }
  | { type: "seek"; position: number }
  | { type: "pause" | "resume" | "stop" }
  | { type: "params"; params: Partial<DspParams> };
export interface MoqListener { url: string; webtransportUrl?: string; websocketUrl?: string; name: string; fingerprint?: string; expires: number }
export interface MoqOutputStatus { settings: MoqSettings; running: boolean; error: string | null; playback: PlaybackStatus }
