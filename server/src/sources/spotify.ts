// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Database } from "bun:sqlite";
import type { SourceConfig, SourceSecrets, Track, ByteRange } from "@jmmp/shared";
import { dirname } from "node:path";
import { decryptJson, encryptJson } from "../crypto.ts";
import { audioAssets } from "../audio/runtime.ts";
import { logPipeline, readHelperEvents, type PipelineDiagnostic } from "../audio/diagnostics.ts";
import type { ServerSourceAdapter } from "./types.ts";

type Config = Extract<SourceConfig, { kind: "spotify" }>;
type Secrets = Extract<SourceSecrets, { kind: "spotify" }>;
const refreshes = new WeakMap<Database, Map<number, Promise<string>>>();
const SPOTIFY_ERRORS: Record<string, string> = {
  search: "Spotify search failed; try again or reconnect this source in Sources",
  login: "Spotify login failed; reconnect this source in Sources",
  playlist: "Spotify playlist unavailable; check its URL and that this account can access it",
  incomplete: "Spotify returned an incomplete playlist; try importing again",
  item: "Spotify playlist contains an unsupported item; only Spotify music tracks can be imported",
  limit: "Spotify playlist import exceeds 10000 tracks",
  unavailable: "Spotify track is unavailable for this account in a supported audio format",
  audio_key: "Spotify could not authorize this track's audio; try again or reconnect the source",
  download: "Spotify audio download failed; check the connection and try again",
  lookup: "Spotify track lookup failed; check the connection and try again",
  timeout: "Spotify track lookup timed out; try again",
};
export class SpotifySourceError extends Error {
  constructor(readonly code: string) {
    super(Object.hasOwn(SPOTIFY_ERRORS, code) ? SPOTIFY_ERRORS[code]! : "Spotify source failed; reconnect or check track availability");
    this.name = "SpotifySourceError";
  }
}
export function spotifyImportError(error: unknown): string {
  if (error instanceof SpotifySourceError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "Spotify playlist import timed out; try again";
  return "Spotify playlist import failed; check the URL and your saved Spotify connection";
}
export function normalizeSpotifyUris(values: unknown): string[] {
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new Error("Provide 1–100 Spotify track, album or playlist links");
  return [...new Set(values.map(value => {
    if (typeof value !== "string") throw new Error("Invalid Spotify link");
    const uri = value.trim().match(/^spotify:(track|album|playlist):([a-zA-Z0-9]{22})$/);
    if (uri) return `spotify:${uri[1]}:${uri[2]}`;
    let url: URL; try { url = new URL(value.trim()); } catch { throw new Error("Invalid Spotify link"); }
    const path = url.pathname.match(/^\/(track|album|playlist)\/([a-zA-Z0-9]{22})\/?$/);
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || !path || url.username || url.password) throw new Error("Use a Spotify track, album or playlist link");
    return `spotify:${path[1]}:${path[2]}`;
  }))];
}
export async function spotifyTokenRequest(params: URLSearchParams): Promise<Secrets> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Spotify authorization failed; reconnect the source");
  const body = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token || typeof body.expires_in !== "number" || body.expires_in <= 0) throw new Error("Invalid Spotify authorization response");
  return { kind: "spotify", accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : "", expiresAt: Date.now() + body.expires_in * 1000 };
}
export function spotifyAccessToken(db: Database, key: CryptoKey, sourceId: number, config: Config): Promise<string> {
  let active = refreshes.get(db); if (!active) { active = new Map(); refreshes.set(db, active); }
  const existing = active.get(sourceId); if (existing) return existing;
  const pending = (async () => {
    const row = db.query<{ creds_encrypted: Uint8Array }, [number]>("SELECT creds_encrypted FROM sources WHERE id = ? AND kind = 'spotify'").get(sourceId);
    if (!row) throw new Error("Spotify source removed");
    const secrets = await decryptJson<Secrets>(key, row.creds_encrypted);
    if (secrets.expiresAt > Date.now() + 60000) return secrets.accessToken;
    if (!secrets.refreshToken) throw new Error("Reconnect this Spotify source");
    const next = await spotifyTokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: secrets.refreshToken, client_id: config.clientId }));
    if (!next.refreshToken) next.refreshToken = secrets.refreshToken;
    // A worker and catalog scan can refresh concurrently. Never replace newer credentials.
    const encrypted = await encryptJson(key, next);
    const updated = db.run("UPDATE sources SET creds_encrypted = ? WHERE id = ? AND creds_encrypted = ?", [encrypted, sourceId, row.creds_encrypted]);
    if (!updated.changes) {
      const latest = db.query<{ creds_encrypted: Uint8Array }, [number]>("SELECT creds_encrypted FROM sources WHERE id = ?").get(sourceId);
      if (!latest) throw new Error("Spotify source removed");
      return (await decryptJson<Secrets>(key, latest.creds_encrypted)).accessToken;
    }
    return next.accessToken;
  })();
  active.set(sourceId, pending); void pending.finally(() => active!.delete(sourceId)).catch(() => {}); return pending;
}

/** NDJSON metadata/header followed by audio. Each line has a strict size bound. */
export class SpotifyPipe {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffered = new Uint8Array(0);
  private heartbeat: ReturnType<typeof setInterval>;
  private diagnostics: Promise<void>;
  private failure: PipelineDiagnostic | undefined;
  constructor(private process: Bun.Subprocess<"pipe", "pipe", "pipe" | "ignore">,
    report: (event: PipelineDiagnostic) => void = () => {}) {
    this.reader = process.stdout.getReader();
    this.diagnostics = process.stderr ? readHelperEvents(process.stderr, () => {}, event => {
      this.failure = { ...this.failure, ...event }; report(event);
    }).catch(() => {}) : Promise.resolve();
    this.heartbeat = setInterval(() => {
      try {
        process.stdin.write("\n");
        void Promise.resolve(process.stdin.flush()).catch(() => clearInterval(this.heartbeat));
      } catch { clearInterval(this.heartbeat); }
    }, 2000);
    void process.exited.finally(() => clearInterval(this.heartbeat));
  }
  private async downloadError(): Promise<SpotifySourceError> {
    const code = await this.process.exited;
    await this.diagnostics;
    const error = new SpotifySourceError("download");
    const details = [`helper exit ${code}`];
    if (this.failure?.reason) details.push(String(this.failure.reason));
    if (typeof this.failure?.attempt === "number") details.push(`${this.failure.attempt} recovery attempts`);
    error.message += ` (${details.join("; ")})`;
    return error;
  }
  async line(): Promise<unknown | null> {
    while (true) {
      const end = this.buffered.indexOf(10);
      if (end >= 0) {
        if (end > 1024 * 1024) throw new Error("Spotify metadata too large");
        const line = this.buffered.slice(0, end); this.buffered = this.buffered.slice(end + 1);
        const value = JSON.parse(new TextDecoder().decode(line));
        if (value?.kind === "error") throw new SpotifySourceError(typeof value.code === "string" ? value.code : "unknown");
        return value;
      }
      if (this.buffered.length > 1024 * 1024) throw new Error("Spotify metadata too large");
      const next = await this.reader.read();
      if (next.done) { if (await this.process.exited || this.buffered.length) throw new Error("Spotify source failed; reconnect or check track availability"); return null; }
      const joined = new Uint8Array(this.buffered.length + next.value.length); joined.set(this.buffered); joined.set(next.value, this.buffered.length); this.buffered = joined;
    }
  }
  close() { clearInterval(this.heartbeat); this.process.stdin.end(); this.process.kill(); void this.reader.cancel().catch(() => {}); }
  audio(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      pull: async controller => {
        try {
          if (this.buffered.length) { controller.enqueue(this.buffered); this.buffered = new Uint8Array(0); return; }
          const next = await this.reader.read();
          if (next.done) { if (await this.process.exited) throw await this.downloadError(); controller.close(); }
          else controller.enqueue(next.value);
        } catch (error) { this.close(); controller.error(error); }
      }, cancel: () => this.close(),
    });
  }
}
export function makeSpotifyAdapter(db: Database, key: CryptoKey, sourceId: number, config: Config, dataDir = dirname(db.filename)): ServerSourceAdapter {
  async function open(operation: "metadata" | "stream" | "search", extras: Record<string, unknown>) {
    const accessToken = await spotifyAccessToken(db, key, sourceId, config);
    const { helper } = await audioAssets(dataDir);
    const child = Bun.spawn([helper, "--spotify"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(JSON.stringify({ operation, clientId: config.clientId, accessToken, ...extras }) + "\n");
    return new SpotifyPipe(child, event => logPipeline({ ...event, sourceId }));
  }
  return {
    async *scan(ctx) {
      if (!config.uris.length) return;
      const pipe = await open("metadata", { uris: normalizeSpotifyUris(config.uris) });
      const abort = () => pipe.close(); ctx.signal?.addEventListener("abort", abort, { once: true });
      const tracks = new Map<string, Omit<Track, "id">>();
      try {
        if (ctx.signal?.aborted) throw new Error("Scan cancelled");
        for (;;) {
          const line = await pipe.line() as { kind: string; track?: Omit<Track, "id" | "sourceId">; sourcePlaylistId?: string; name?: string; tracks?: string[]; skippedTracks?: number } | null;
          if (!line) break;
          if (line.kind === "track" && line.track) {
            const track = { ...line.track, sourceId, serverAvailable: true }; tracks.set(track.sourceTrackId, track);
            yield { kind: "add", track }; ctx.onProgress?.(tracks.size);
          } else if (line.kind === "playlist" && line.tracks && line.sourcePlaylistId && line.name) {
            const skippedTracks = line.skippedTracks ?? 0;
            if (!Number.isSafeInteger(skippedTracks) || skippedTracks < 0 || skippedTracks > 10000) throw new Error("Invalid Spotify metadata");
            yield { kind: "playlist", sourcePlaylistId: line.sourcePlaylistId, name: line.name, tracks: line.tracks.map(id => { const track = tracks.get(id); if (!track) throw new Error("Incomplete Spotify playlist"); return track; }), skippedTracks };
          } else throw new Error("Invalid Spotify metadata");
        }
      } finally { ctx.signal?.removeEventListener("abort", abort); pipe.close(); }
    },
    async search(query: string, limit: number) {
      query = query.trim();
      if ([...query].length < 2 || [...query].length > 256 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid Spotify search");
      const pipe = await open("search", { query, limit });
      const timeout = setTimeout(() => pipe.close(), 30000);
      const tracks: Track[] = [];
      const seen = new Set<string>();
      try {
        for (;;) {
          const line = await pipe.line() as { kind?: string; track?: Omit<Track, "id" | "sourceId"> } | null;
          if (!line) break;
          if (line.kind !== "track" || !line.track || !/^spotify:track:[a-zA-Z0-9]{22}$/.test(line.track.sourceTrackId)) throw new SpotifySourceError("search");
          if (!seen.has(line.track.sourceTrackId)) {
            seen.add(line.track.sourceTrackId);
            tracks.push({ ...line.track, id: 0, sourceId, serverAvailable: true });
          }
          if (tracks.length >= limit) break;
        }
        return { tracks, albums: [], artists: [] };
      } finally { clearTimeout(timeout); pipe.close(); }
    },
    async fetch(id: string, range?: ByteRange) {
      const uri = normalizeSpotifyUris([id])[0]!;
      if (!uri.startsWith("spotify:track:")) throw new Error("Spotify track required");
      const pipe = await open("stream", { uri, range });
      try {
        const header = await pipe.line() as { status: number; size: number; start: number; end: number } | null;
        if (!header || ![200,206].includes(header.status) || ![header.size,header.start,header.end].every(Number.isSafeInteger) || header.start < 0 || header.end < header.start || header.end >= header.size) throw new Error("Invalid Spotify audio response");
        const headers = new Headers({ "Content-Type": "audio/ogg", "Content-Length": String(header.end-header.start+1), "Accept-Ranges": "bytes" });
        if (header.status === 206) headers.set("Content-Range", `bytes ${header.start}-${header.end}/${header.size}`);
        return { body: pipe.audio(), status: header.status, headers };
      } catch (error) { pipe.close(); throw error; }
    },
  };
}
