// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type {
  Album,
  Artist,
  ByteRange,
  ScanEvent,
  SearchResult,
  SourceConfig,
  SourceSecrets,
  Track,
} from "@jmmp/shared";
import { randomUUID } from "node:crypto";
import type { ScanContext, ServerSourceAdapter, UpstreamFetchResult } from "./types.ts";

export interface QobuzConfig {
  kind: "qobuz";
  userId: string;
  email: string;
}

export interface QobuzSecrets {
  kind: "qobuz";
  userAuthToken: string;
  appId: string;
  appSecret: string;
  harvestedAt: number;
}

const API_BASE = "https://www.qobuz.com/api.json/0.2";
const OAUTH_BASE = "https://www.qobuz.com";
const BUNDLE_URL = "https://play.qobuz.com/";
export const QOBUZ_OAUTH_PRIVATE_KEY = "6lz8C03UDIC7";
export const QOBUZ_PRODUCTION_SIGNING_SECRET = "abb21364945c0583309667d13ca3d93a";
const QOBUZ_PAGE_LIMIT = 500;
const QOBUZ_SCAN_CONCURRENCY = 4;
type FetchLike = typeof fetch;

export interface HarvestedAppCreds {
  appId: string;
  /**
   * Qobuz still calls this appSecret in its API client, but signed requests now
   * use the web player's current derived signing seed rather than the visible
   * production appSecret literal.
   */
  appSecret: string;
  bundleAppSecret?: string;
  oauthPrivateKey?: string;
}

export class QobuzHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "QobuzHttpError";
  }
}

export async function harvestAppCreds(): Promise<HarvestedAppCreds> {
  const indexResp = await fetch(BUNDLE_URL, {
    headers: { "User-Agent": "jmmp/0.1 (+harvest)" },
  });
  if (!indexResp.ok) {
    throw new Error(`Qobuz bundle fetch failed: HTTP ${indexResp.status}`);
  }
  const indexHtml = await indexResp.text();
  const bundleMatch = indexHtml.match(/<script src="(\/resources\/[^"]+\/bundle\.js)"/);
  if (!bundleMatch) throw new Error("Qobuz bundle URL not found in index");
  const bundleResp = await fetch(`https://play.qobuz.com${bundleMatch[1]}`);
  if (!bundleResp.ok) {
    throw new Error(`Qobuz bundle js failed: HTTP ${bundleResp.status}`);
  }
  const js = await bundleResp.text();

  const appIdMatch = js.match(/production:\{api:\{appId:"(\d+)",appSecret:"([0-9a-f]+)"/);
  const oauthPrivateKey = js.match(/privateKey:"([^"]+)"/)?.[1] ?? QOBUZ_OAUTH_PRIVATE_KEY;
  const signingSecret = extractQobuzSigningSecret(js) ?? QOBUZ_PRODUCTION_SIGNING_SECRET;
  if (appIdMatch) {
    return {
      appId: appIdMatch[1]!,
      appSecret: signingSecret,
      bundleAppSecret: appIdMatch[2]!,
      oauthPrivateKey,
    };
  }
  const appIdLoose = js.match(/appId:"(\d+)"/);
  const secretLoose = js.match(/appSecret:"([0-9a-f]{32,})"/);
  if (appIdLoose && secretLoose) {
    return {
      appId: appIdLoose[1]!,
      appSecret: signingSecret,
      bundleAppSecret: secretLoose[1]!,
      oauthPrivateKey,
    };
  }
  throw new Error("Could not extract Qobuz app credentials from bundle");
}

export function deriveQobuzSigningSecret(
  seed: string,
  info: string,
  extras: string
): string {
  const combined = seed + info + extras;
  return Buffer.from(combined.slice(0, combined.length - 44), "base64").toString(
    "utf8"
  );
}

export function extractQobuzSigningSecret(js: string): string | undefined {
  const seed =
    js.match(
      /initialization=function\(\).*?:c\.initialSeed\("([^"]+)",window\.utimezone\.berlin\)/
    )?.[1] ??
    js.match(/:c\.initialSeed\("([^"]+)",window\.utimezone\.berlin\)/)?.[1];
  const berlin = js.match(/name:"Europe\/Berlin",info:"([^"]+)",extras:"([^"]+)"/);
  if (!seed || !berlin) return undefined;
  return deriveQobuzSigningSecret(seed, berlin[1]!, berlin[2]!);
}

export interface QobuzLoginResult {
  userAuthToken: string;
  userId: string;
  email: string;
  appId: string;
  appSecret: string;
}

export function oauthSignInUrl(appId: string, redirectUrl: string): string {
  const url = new URL("/signin/oauth", OAUTH_BASE);
  url.searchParams.set("ext_app_id", appId);
  url.searchParams.set("redirect_url", redirectUrl);
  return url.toString();
}

export function oauthCodeFromParams(params: URLSearchParams): string {
  return (
    params.get("code") ||
    params.get("code_autorisation") ||
    params.get("code_authorisation") ||
    params.get("code_authorization") ||
    ""
  );
}

export async function oauthLogin(
  code: string,
  privateKey?: string
): Promise<QobuzLoginResult> {
  const creds = await harvestAppCreds();
  return exchangeOAuthCode(
    code,
    privateKey ?? creds.oauthPrivateKey ?? QOBUZ_OAUTH_PRIVATE_KEY,
    creds
  );
}

export async function exchangeOAuthCode(
  code: string,
  privateKey: string,
  creds: HarvestedAppCreds
): Promise<QobuzLoginResult> {
  const url = new URL(`${API_BASE}/oauth/callback`);
  url.searchParams.set("code", code);
  url.searchParams.set("private_key", privateKey);
  const resp = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-App-Id": creds.appId,
    },
  });
  if (!resp.ok) {
    throw new QobuzHttpError(
      await describeQobuzFailure(resp, "OAuth callback"),
      resp.status
    );
  }
  const body = (await resp.json()) as Record<string, unknown>;
  const userAuthToken = text(body["token"]) || text(body["user_auth_token"]);
  const user = record(body["user"]);
  let userId = text(body["user_id"]) || text(body["userId"]) || text(user?.["id"]);
  let email = text(body["email"]) || text(user?.["email"]);
  if (!userAuthToken) {
    throw new Error("Qobuz OAuth: malformed callback response");
  }
  if (!userId || !email) {
    const userInfo = await fetchAuthenticatedUser(userAuthToken, creds.appId);
    userId ||= userInfo.userId;
    email ||= userInfo.email;
  }
  if (!userId || !email) {
    throw new Error("Qobuz OAuth: malformed user response");
  }
  return {
    userAuthToken,
    userId,
    email,
    appId: creds.appId,
    appSecret: creds.appSecret,
  };
}

export async function login(email: string, password: string): Promise<QobuzLoginResult> {
  const creds = await harvestAppCreds();
  const params = new URLSearchParams({
    app_id: creds.appId,
    email: email.trim(),
    password,
  });
  params.set("device_manufacturer_id", randomUUID());
  const resp = await fetch(`${API_BASE}/user/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-App-Id": creds.appId,
    },
    body: params,
  });
  if (!resp.ok) {
    throw new QobuzHttpError(await describeQobuzFailure(resp, "login"), resp.status);
  }
  const body = (await resp.json()) as {
    user_auth_token?: string;
    user?: { id: number; email: string };
  };
  if (!body.user_auth_token || !body.user) {
    throw new Error("Qobuz login: malformed response");
  }
  return {
    userAuthToken: body.user_auth_token,
    userId: String(body.user.id),
    email: body.user.email,
    appId: creds.appId,
    appSecret: creds.appSecret,
  };
}

async function fetchAuthenticatedUser(
  userAuthToken: string,
  appId: string
): Promise<{ userId: string; email: string }> {
  const params = new URLSearchParams({ extra: "partner" });
  params.set("device_manufacturer_id", randomUUID());
  const resp = await fetch(`${API_BASE}/user/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-App-Id": appId,
      "X-User-Auth-Token": userAuthToken,
    },
    body: params,
  });
  if (!resp.ok) {
    throw new QobuzHttpError(
      await describeQobuzFailure(resp, "authenticated user lookup"),
      resp.status
    );
  }
  const body = (await resp.json()) as Record<string, unknown>;
  const user = record(body["user"]);
  return {
    userId: text(body["user_id"]) || text(body["userId"]) || text(user?.["id"]),
    email: text(body["email"]) || text(user?.["email"]),
  };
}

async function signedQuery(
  endpoint: string,
  params: Record<string, string>,
  secrets: QobuzSecrets
): Promise<Record<string, unknown>> {
  try {
    return await signedQueryWithSecret(endpoint, params, secrets, secrets.appSecret);
  } catch (err) {
    if (!isInvalidSignatureError(err)) throw err;
    const fresh = await harvestAppCreds();
    if (!fresh.appSecret || fresh.appSecret === secrets.appSecret) throw err;
    secrets.appId = fresh.appId;
    secrets.appSecret = fresh.appSecret;
    secrets.harvestedAt = Math.floor(Date.now() / 1000);
    return signedQueryWithSecret(endpoint, params, secrets, fresh.appSecret);
  }
}

async function signedQueryWithSecret(
  endpoint: string,
  params: Record<string, string>,
  secrets: QobuzSecrets,
  signingSecret: string
): Promise<Record<string, unknown>> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sorted = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1));
  const requestSig = await qobuzRequestSignature(endpoint, params, ts, signingSecret);
  const url = new URL(`${API_BASE}${endpoint}`);
  for (const [k, v] of sorted) url.searchParams.set(k, v);
  url.searchParams.set("request_ts", ts);
  url.searchParams.set("request_sig", requestSig);
  url.searchParams.set("app_id", secrets.appId);
  const resp = await fetch(url.toString(), {
    headers: {
      "X-App-Id": secrets.appId,
      "X-User-Auth-Token": secrets.userAuthToken,
    },
  });
  if (!resp.ok) {
    throw new QobuzHttpError(await describeQobuzFailure(resp, endpoint), resp.status);
  }
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function qobuzRequestSignature(
  endpoint: string,
  params: Record<string, string>,
  requestTs: string,
  signingSecret: string
): Promise<string> {
  const sorted = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1));
  let toSign = endpoint.replace(/\//g, "");
  for (const [k, v] of sorted) toSign += `${k}${v}`;
  toSign += requestTs + signingSecret;
  return md5Hex(toSign);
}

function isInvalidSignatureError(err: unknown): boolean {
  return (
    err instanceof QobuzHttpError &&
    err.status === 400 &&
    /request_sig|signature/i.test(err.message)
  );
}

async function unsignedQuery(
  endpoint: string,
  params: Record<string, string>,
  secrets: QobuzSecrets
): Promise<Record<string, unknown>> {
  return unsignedQueryWithFetch(endpoint, params, secrets, fetch);
}

async function unsignedQueryWithFetch(
  endpoint: string,
  params: Record<string, string>,
  secrets: QobuzSecrets,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const url = new URL(`${API_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-App-Id": secrets.appId,
      "X-User-Auth-Token": secrets.userAuthToken,
    },
  });
  if (!resp.ok) {
    throw new QobuzHttpError(await describeQobuzFailure(resp, endpoint), resp.status);
  }
  const body = await resp.text();
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

async function describeQobuzFailure(resp: Response, context: string): Promise<string> {
  const detail = cleanQobuzMessage(await readQobuzErrorMessage(resp));
  if (context === "login" && resp.status === 401) {
    return [
      "Qobuz rejected the email/password (HTTP 401).",
      "If this account normally signs in through Apple, Google, or Facebook, set a Qobuz password first.",
      detail ? `Qobuz said: ${detail}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return `Qobuz ${context} failed: HTTP ${resp.status}${detail ? `: ${detail}` : ""}`;
}

async function readQobuzErrorMessage(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as unknown;
    if (isRecord(body)) {
      return text(body["message"]) || text(body["error"]) || "";
    }
  } catch {
    // Ignore malformed/non-JSON upstream error bodies; the status is enough.
  }
  return "";
}

function cleanQobuzMessage(message: string): string {
  return message.replace(/\s*\(Root=[^)]+\)\s*$/u, "").trim();
}

async function md5Hex(s: string): Promise<string> {
  // Bun exposes Bun.MD5 / Bun.CryptoHasher; use CryptoHasher for portability.
  // crypto.subtle does not support MD5; implement via Node-compat path.
  const crypto = await import("node:crypto");
  return crypto.createHash("md5").update(s).digest("hex");
}

export async function resolveStreamUrl(
  trackId: string,
  secrets: QobuzSecrets,
  formatId: number
): Promise<{ url: string; mimeType: string }> {
  const result = await signedQuery(
    "/track/getFileUrl",
    {
      track_id: trackId,
      format_id: String(formatId),
      intent: "stream",
    },
    secrets
  );
  const url = String(result["url"] ?? "");
  const mimeType = String(result["mime_type"] ?? "audio/flac");
  if (!url) throw new Error("Qobuz returned empty URL");
  return { url, mimeType };
}

export async function searchCatalog(
  query: string,
  secrets: QobuzSecrets,
  limit = 50
): Promise<Record<string, unknown>> {
  return signedQuery(
    "/catalog/search",
    { query, limit: String(limit) },
    secrets
  );
}

export async function createQobuzPlaylist(
  secrets: QobuzSecrets,
  name: string,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const body = await postQobuzForm(
    "/playlist/create",
    {
      name,
      description: "",
    },
    secrets,
    fetchImpl
  );
  const playlist = record(body["playlist"]);
  const id =
    text(body["id"]) ||
    text(body["playlist_id"]) ||
    text(body["playlistId"]) ||
    text(playlist?.["id"]);
  if (!id) throw new Error("Qobuz playlist create returned no playlist id");
  return id;
}

export interface QobuzPlaylistTrackRef {
  trackId: string;
  playlistTrackId: string;
}

export async function syncQobuzPlaylistTracks(
  secrets: QobuzSecrets,
  playlistId: string,
  orderedSourceTrackIds: string[],
  fetchImpl: FetchLike = fetch
): Promise<void> {
  let refs = await fetchQobuzPlaylistTrackRefs(secrets, playlistId, fetchImpl);
  const missing = missingSourceTrackIds(refs, orderedSourceTrackIds);
  if (missing.length) {
    await postQobuzForm(
      "/playlist/addTracks",
      {
        playlist_id: playlistId,
        track_ids: missing.join(","),
      },
      secrets,
      fetchImpl
    );
    refs = await fetchQobuzPlaylistTrackRefs(secrets, playlistId, fetchImpl);
  }

  const extras = extraPlaylistTrackIds(refs, orderedSourceTrackIds);
  if (extras.length) {
    await postQobuzForm(
      "/playlist/deleteTracks",
      {
        playlist_id: playlistId,
        playlist_track_ids: extras.join(","),
      },
      secrets,
      fetchImpl
    );
  }

  await syncQobuzPlaylistOrder(
    secrets,
    playlistId,
    orderedSourceTrackIds,
    fetchImpl
  );
}

export async function syncQobuzPlaylistOrder(
  secrets: QobuzSecrets,
  playlistId: string,
  orderedSourceTrackIds: string[],
  fetchImpl: FetchLike = fetch
): Promise<void> {
  if (orderedSourceTrackIds.length < 2) return;
  const refs = await fetchQobuzPlaylistTrackRefs(secrets, playlistId, fetchImpl);
  const target = targetPlaylistTrackIds(refs, orderedSourceTrackIds);
  const current = refs.map((ref) => ref.playlistTrackId);
  if (arraysEqual(current, target)) return;

  for (let targetIndex = 0; targetIndex < target.length; targetIndex++) {
    if (current[targetIndex] === target[targetIndex]) continue;
    const currentIndex = current.indexOf(target[targetIndex]!, targetIndex + 1);
    if (currentIndex < 0) continue;
    const [moved] = current.splice(currentIndex, 1);
    current.splice(targetIndex, 0, moved!);
    await postQobuzForm(
      "/playlist/updateTracksPosition",
      {
        playlist_id: playlistId,
        playlist_track_ids: moved!,
        insert_before: String(targetIndex + 1),
      },
      secrets,
      fetchImpl
    );
  }
}

async function fetchQobuzPlaylistTrackRefs(
  secrets: QobuzSecrets,
  playlistId: string,
  fetchImpl: FetchLike = fetch
): Promise<QobuzPlaylistTrackRef[]> {
  const refs: QobuzPlaylistTrackRef[] = [];
  let offset = 0;
  while (true) {
    const page = await unsignedQueryWithFetch(
      "/playlist/get",
      {
        playlist_id: playlistId,
        extra: "tracks",
        limit: String(QOBUZ_PAGE_LIMIT),
        offset: String(offset),
      },
      secrets,
      fetchImpl
    );
    const items = collection(page, "tracks");
    for (const item of items) {
      const trackId = text(item["id"]) || text(item["track_id"]);
      const playlistTrackId =
        text(item["playlist_track_id"]) || text(item["playlistTrackId"]);
      if (trackId && playlistTrackId) refs.push({ trackId, playlistTrackId });
    }
    const tracksPage = record(page["tracks"]);
    const total = numberValue(tracksPage?.["total"]);
    if (items.length === 0 || total === undefined || offset + items.length >= total) {
      break;
    }
    offset += items.length;
  }
  return refs;
}

function missingSourceTrackIds(
  refs: QobuzPlaylistTrackRef[],
  orderedSourceTrackIds: string[]
): string[] {
  const currentCounts = countStrings(refs.map((ref) => ref.trackId));
  const missing: string[] = [];
  for (const trackId of orderedSourceTrackIds) {
    const count = currentCounts.get(trackId) ?? 0;
    if (count > 0) {
      if (count === 1) currentCounts.delete(trackId);
      else currentCounts.set(trackId, count - 1);
    } else {
      missing.push(trackId);
    }
  }
  return missing;
}

function extraPlaylistTrackIds(
  refs: QobuzPlaylistTrackRef[],
  orderedSourceTrackIds: string[]
): string[] {
  const desiredCounts = countStrings(orderedSourceTrackIds);
  const extras: string[] = [];
  for (const ref of refs) {
    const count = desiredCounts.get(ref.trackId) ?? 0;
    if (count > 0) {
      if (count === 1) desiredCounts.delete(ref.trackId);
      else desiredCounts.set(ref.trackId, count - 1);
    } else {
      extras.push(ref.playlistTrackId);
    }
  }
  return extras;
}

function countStrings(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function targetPlaylistTrackIds(
  refs: QobuzPlaylistTrackRef[],
  orderedSourceTrackIds: string[]
): string[] {
  const refsByTrackId = new Map<string, QobuzPlaylistTrackRef[]>();
  for (const ref of refs) {
    const existing = refsByTrackId.get(ref.trackId);
    if (existing) existing.push(ref);
    else refsByTrackId.set(ref.trackId, [ref]);
  }

  const consumed = new Set<string>();
  const target: string[] = [];
  for (const trackId of orderedSourceTrackIds) {
    const ref = refsByTrackId.get(trackId)?.shift();
    if (!ref) continue;
    consumed.add(ref.playlistTrackId);
    target.push(ref.playlistTrackId);
  }
  for (const ref of refs) {
    if (!consumed.has(ref.playlistTrackId)) target.push(ref.playlistTrackId);
  }
  return target;
}

async function postQobuzForm(
  endpoint: string,
  params: Record<string, string>,
  secrets: QobuzSecrets,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const resp = await fetchImpl(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-App-Id": secrets.appId,
      "X-User-Auth-Token": secrets.userAuthToken,
    },
    body: new URLSearchParams(params),
  });
  if (!resp.ok) {
    throw new QobuzHttpError(await describeQobuzFailure(resp, endpoint), resp.status);
  }
  const body = await resp.text();
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function mapQobuzSearchResponse(
  raw: Record<string, unknown>,
  sourceId: number
): SearchResult {
  const tracks = collection(raw, "tracks")
    .map((item) => mapQobuzTrack(item, sourceId))
    .filter((track): track is Track => track !== null);

  const artists = new Map<string, Artist>();
  const albums = new Map<string, Album>();
  for (const track of tracks) {
    if (track.artist) {
      artists.set(`${sourceId}::${track.artist}`, {
        id: `${sourceId}::${track.artist}`,
        sourceId,
        name: track.artist,
      });
    }
    if (track.album) {
      albums.set(`${sourceId}::${track.album}`, {
        id: `${sourceId}::${track.album}`,
        sourceId,
        title: track.album,
        artist: track.artist,
        albumArtist: track.albumArtist,
        year: track.year,
        artHash: track.artHash,
      });
    }
  }

  for (const item of collection(raw, "artists")) {
    const name = text(item["name"]);
    const id = text(item["id"]) || name;
    if (name) artists.set(`${sourceId}::artist:${id}`, { id: `${sourceId}::artist:${id}`, sourceId, name });
  }

  for (const item of collection(raw, "albums")) {
    const title = text(item["title"]);
    const id = text(item["id"]) || title;
    if (!title) continue;
    const artist = artistName(item) || "";
    albums.set(`${sourceId}::album:${id}`, {
      id: `${sourceId}::album:${id}`,
      sourceId,
      title,
      artist,
      albumArtist: artist,
      year: releaseYear(item),
      artHash: imageId(item),
    });
  }

  return {
    tracks,
    albums: [...albums.values()],
    artists: [...artists.values()],
  };
}

export function makeQobuzAdapter(
  config: SourceConfig,
  secrets: SourceSecrets,
  sourceId: number
): ServerSourceAdapter {
  if (config.kind !== "qobuz" || secrets.kind !== "qobuz") {
    throw new Error("not a qobuz source");
  }
  const qobuzSecrets = secrets as QobuzSecrets;

  return {
    async *scan(): AsyncIterable<ScanEvent> {
      yield* scanQobuzLibrary(sourceId, qobuzSecrets);
    },

    async fetch(sourceTrackId: string, range?: ByteRange): Promise<UpstreamFetchResult> {
      const { url } = await resolveStreamUrl(sourceTrackId, qobuzSecrets, 27);
      const reqHeaders: Record<string, string> = {};
      if (range) {
        reqHeaders["range"] =
          range.end !== undefined
            ? `bytes=${range.start}-${range.end}`
            : `bytes=${range.start}-`;
      }
      const resp = await fetch(url, { headers: reqHeaders });
      if (!resp.body) throw new Error("Qobuz fetch returned no body");
      return { body: resp.body, status: resp.status, headers: resp.headers };
    },

    async search(query: string, limit: number): Promise<SearchResult> {
      const raw = await searchCatalog(query, qobuzSecrets, limit);
      return mapQobuzSearchResponse(raw, sourceId);
    },

    async createPlaylist(name: string): Promise<string> {
      return createQobuzPlaylist(qobuzSecrets, name);
    },

    async syncPlaylistOrder(
      sourcePlaylistId: string,
      orderedSourceTrackIds: string[]
    ): Promise<void> {
      await syncQobuzPlaylistOrder(
        qobuzSecrets,
        sourcePlaylistId,
        orderedSourceTrackIds
      );
    },

    async syncPlaylistTracks(
      sourcePlaylistId: string,
      orderedSourceTrackIds: string[]
    ): Promise<void> {
      await syncQobuzPlaylistTracks(
        qobuzSecrets,
        sourcePlaylistId,
        orderedSourceTrackIds
      );
    },
  };
}

async function* scanQobuzLibrary(
  sourceId: number,
  secrets: QobuzSecrets
): AsyncIterable<ScanEvent> {
  const yieldedAlbums = new Set<string>();

  for await (const item of pagedQobuzItems(
    "/favorite/getUserFavorites",
    "tracks",
    { type: "tracks" },
    secrets
  )) {
    const track = mapQobuzTrack(item, sourceId);
    if (track) yield { kind: "add", track };
  }

  let albumBatch: string[] = [];
  for await (const album of pagedQobuzItems(
    "/favorite/getUserFavorites",
    "albums",
    { type: "albums" },
    secrets
  )) {
    const albumId = text(album["id"]);
    if (!albumId || yieldedAlbums.has(albumId)) continue;
    yieldedAlbums.add(albumId);
    albumBatch.push(albumId);
    if (albumBatch.length >= QOBUZ_SCAN_CONCURRENCY) {
      yield* scanAlbumBatch(sourceId, secrets, albumBatch);
      albumBatch = [];
    }
  }
  if (albumBatch.length) {
    yield* scanAlbumBatch(sourceId, secrets, albumBatch);
  }

  let playlistBatch: Array<{ id: string; name: string }> = [];
  for await (const playlist of pagedQobuzItems(
    "/playlist/getUserPlaylists",
    "playlists",
    {},
    secrets
  )) {
    const playlistId = text(playlist["id"]);
    const name = text(playlist["name"]);
    if (!playlistId || !name) continue;
    playlistBatch.push({ id: playlistId, name });
    if (playlistBatch.length >= QOBUZ_SCAN_CONCURRENCY) {
      yield* scanPlaylistBatch(sourceId, secrets, playlistBatch);
      playlistBatch = [];
    }
  }
  if (playlistBatch.length) {
    yield* scanPlaylistBatch(sourceId, secrets, playlistBatch);
  }
}

async function* scanAlbumBatch(
  sourceId: number,
  secrets: QobuzSecrets,
  albumIds: string[]
): AsyncIterable<ScanEvent> {
  const albums = await Promise.all(
    albumIds.map((albumId) =>
      unsignedQuery("/album/get", { album_id: albumId }, secrets)
    )
  );
  for (const fullAlbum of albums) {
    for (const item of collection(fullAlbum, "tracks")) {
      const track = mapQobuzTrack(item, sourceId, fullAlbum);
      if (track) yield { kind: "add", track };
    }
  }
}

async function* scanPlaylistBatch(
  sourceId: number,
  secrets: QobuzSecrets,
  playlists: Array<{ id: string; name: string }>
): AsyncIterable<ScanEvent> {
  const events = await Promise.all(
    playlists.map(async (playlist) => ({
      kind: "playlist" as const,
      sourcePlaylistId: playlist.id,
      name: playlist.name,
      tracks: await fetchQobuzPlaylistTracks(sourceId, secrets, playlist.id),
    }))
  );
  for (const event of events) yield event;
}

async function fetchQobuzPlaylistTracks(
  sourceId: number,
  secrets: QobuzSecrets,
  playlistId: string
): Promise<Array<Omit<Track, "id">>> {
  const tracks: Array<Omit<Track, "id">> = [];
  let offset = 0;
  while (true) {
    const page = await unsignedQuery(
      "/playlist/get",
      {
        playlist_id: playlistId,
        extra: "tracks",
        limit: String(QOBUZ_PAGE_LIMIT),
        offset: String(offset),
      },
      secrets
    );
    const items = collection(page, "tracks");
    for (const item of items) {
      const track = mapQobuzTrack(item, sourceId);
      if (track) tracks.push(track);
    }
    const tracksPage = record(page["tracks"]);
    const total = numberValue(tracksPage?.["total"]);
    if (items.length === 0 || total === undefined || offset + items.length >= total) {
      break;
    }
    offset += items.length;
  }
  return tracks;
}

async function* pagedQobuzItems(
  endpoint: string,
  collectionKey: string,
  params: Record<string, string>,
  secrets: QobuzSecrets
): AsyncIterable<Record<string, unknown>> {
  let offset = 0;
  while (true) {
    const raw = await unsignedQuery(
      endpoint,
      {
        ...params,
        limit: String(QOBUZ_PAGE_LIMIT),
        offset: String(offset),
      },
      secrets
    );
    const page = record(raw[collectionKey]);
    const items = page ? collection(raw, collectionKey) : [];
    for (const item of items) yield item;
    const total = numberValue(page?.["total"]);
    if (items.length === 0 || total === undefined || offset + items.length >= total) {
      break;
    }
    offset += items.length;
  }
}

function mapQobuzTrack(
  item: Record<string, unknown>,
  sourceId: number,
  albumOverride?: Record<string, unknown>
): Track | null {
  const id = text(item["id"]);
  if (!id) return null;
  const album = record(item["album"]) ?? albumOverride ?? null;
  const title = text(item["title"]) || "Untitled";
  const artist = artistName(item) || (album ? artistName(album) : "") || "";
  const albumTitle = album ? text(album["title"]) : "";
  const duration = numberValue(item["duration"]) ?? 0;
  return {
    id: 0,
    sourceId,
    sourceTrackId: id,
    title,
    artist,
    albumArtist: album ? artistName(album) || undefined : undefined,
    album: albumTitle,
    year: releaseYear(album ?? item),
    trackNo: numberValue(item["track_number"]) ?? undefined,
    discNo: numberValue(item["media_number"]) ?? undefined,
    durationMs: Math.max(0, Math.round(duration * 1000)),
    codec: "flac",
    sampleRate: sampleRate(item["maximum_sampling_rate"]),
    bitDepth: numberValue(item["maximum_bit_depth"]) ?? undefined,
    channels: undefined,
    fileSize: undefined,
    artHash: album ? imageId(album) : undefined,
  };
}

function collection(raw: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = raw[key];
  if (Array.isArray(value)) return value.filter(isRecord);
  const wrapped = record(value);
  const items = wrapped ? wrapped["items"] : undefined;
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

function artistName(item: Record<string, unknown>): string | undefined {
  const performer = record(item["performer"]);
  const artist = record(item["artist"]);
  return text(performer?.["name"]) || text(artist?.["name"]) || text(item["artist"]) || undefined;
}

function releaseYear(item: Record<string, unknown> | null): number | undefined {
  if (!item) return undefined;
  const releasedAt = numberValue(item["released_at"]);
  if (releasedAt) {
    const year = new Date(releasedAt * 1000).getUTCFullYear();
    if (Number.isFinite(year)) return year;
  }
  const raw = text(item["release_date_original"]) || text(item["release_date"]) || text(item["released_at"]);
  if (!raw) return undefined;
  const year = new Date(raw).getUTCFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function imageId(item: Record<string, unknown>): string | undefined {
  const image = record(item["image"]);
  return (
    text(image?.["large"]) ||
    text(image?.["small"]) ||
    text(image?.["thumbnail"]) ||
    undefined
  );
}

function sampleRate(value: unknown): number | undefined {
  const n = numberValue(value);
  if (!n) return undefined;
  return n > 1000 ? Math.round(n) : Math.round(n * 1000);
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
