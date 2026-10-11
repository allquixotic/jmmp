// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes } from "node:crypto";
import { get, post, ok, fail, readJson, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";
import { encryptJson } from "../crypto.ts";
import { normalizeSpotifyUris, spotifyTokenRequest } from "../sources/spotify.ts";
import { runScan } from "../scan/worker.ts";
import { configuredRequestOrigin } from "../origins.ts";

// Match the built-in client and registered redirect in librespot's OAuth example.
// A remote server cannot receive a callback to the user's loopback interface:
// the user pastes that final URL into their authenticated jmmp session instead.
export const LIBRESPOT_CLIENT_ID = "65b708073fc0480ea92a077233ca87bd";
export const LIBRESPOT_REDIRECT_URI = "http://127.0.0.1:8898/login";

interface Pending {
  did: string;
  jti: string;
  created: number;
  clientId: string;
  redirectUri: string;
  manualCallback: boolean;
  verifier: string;
  uris: string[];
  name: string;
  status: "pending" | "exchanging" | "complete" | "error";
  sourceId?: number;
}
const pending = new Map<string, Pending>();
function cleanup() {
  for (const [state, value] of pending) {
    if (Date.now() - value.created > 600000) pending.delete(state);
  }
}
export function spotifyRedirectUri(req: Req): string {
  // Match the configured public host rather than trusting forwarded headers.
  const origin = configuredRequestOrigin(req.request, req.ctx.cfg.webauthn.origin);
  if (origin.protocol !== "https:" && !["127.0.0.1", "[::1]"].includes(origin.hostname)) {
    throw new Error("Spotify requires HTTPS or a loopback IP callback");
  }
  return `${origin.origin}/api/sources/spotify/oauth/callback`;
}

async function finishSignIn(req: Req, entry: Pending, code: string | null): Promise<Response> {
  entry.status = "exchanging";
  try {
    if (!code) throw new Error("Spotify authorization denied");
    const secrets = await spotifyTokenRequest(new URLSearchParams({
      grant_type: "authorization_code", code, client_id: entry.clientId,
      redirect_uri: entry.redirectUri, code_verifier: entry.verifier,
    }));
    if (!secrets.refreshToken) throw new Error("Spotify refresh credential missing");
    const config = { kind: "spotify", clientId: entry.clientId, redirectUri: entry.redirectUri, uris: entry.uris };
    const encrypted = await encryptJson(req.ctx.machineKey, secrets);
    const insert = req.ctx.db.run(
      "INSERT INTO sources(kind,name,config_json,creds_encrypted,fetch_mode,cache_policy) VALUES ('spotify',?,?,?,'proxy','pin-only')",
      [entry.name, JSON.stringify(config), encrypted],
    );
    entry.sourceId = Number(insert.lastInsertRowid);
    entry.status = "complete";
    entry.verifier = "";
    if (entry.uris.length) void runScan(req.ctx.db, req.ctx.machineKey, entry.sourceId, { extractMetadata: false });
    if (entry.manualCallback) return ok({ status: "complete", sourceId: entry.sourceId });
    return new Response('<!doctype html><html><head><meta charset="utf-8"><title>Spotify connected</title></head><body><h1>Spotify connected</h1><p>Return to jmmp. Import playlist URLs from Playlists whenever you like.</p></body></html>', {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    entry.status = "error";
    entry.verifier = "";
    return fail("Spotify sign-in failed; start again", 502);
  }
}

post("/api/sources/spotify/oauth/start", async req => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  cleanup();
  try {
    const body = await readJson<{ clientId?: unknown; sourceName?: string; uris?: unknown }>(req);
    if (body.clientId !== undefined && typeof body.clientId !== "string") return fail("Invalid Spotify application client ID");
    const customClientId = body.clientId?.trim();
    if (customClientId && !/^[a-fA-F0-9]{32}$/.test(customClientId)) return fail("Invalid Spotify application client ID");
    if (pending.size >= 100) return fail("Too many pending sign-ins", 429);
    // Validate the public request origin for both built-in and custom-app flows.
    configuredRequestOrigin(req.request, req.ctx.cfg.webauthn.origin);
    const manualCallback = !customClientId;
    const redirectUri = manualCallback ? LIBRESPOT_REDIRECT_URI : spotifyRedirectUri(req);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const entry: Pending = {
      did: session.did, jti: session.jti, created: Date.now(),
      clientId: customClientId || LIBRESPOT_CLIENT_ID, redirectUri, manualCallback, verifier,
      uris: body.uris === undefined || Array.isArray(body.uris) && !body.uris.length ? [] : normalizeSpotifyUris(body.uris),
      name: body.sourceName?.trim().slice(0, 200) || "Spotify", status: "pending",
    };
    pending.set(state, entry);
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: entry.clientId, response_type: "code", redirect_uri: redirectUri, state,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      scope: manualCallback ? "streaming" : "streaming user-read-private user-read-email playlist-read-private playlist-read-collaborative",
    }).toString();
    return ok({ state, authUrl: url.href, manualCallback, redirectUri });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid Spotify configuration");
  }
});

get("/api/sources/spotify/oauth/status/:state", async req => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  cleanup();
  const entry = pending.get(req.params.state!);
  if (!entry || entry.did !== session.did || entry.jti !== session.jti) return fail("Spotify sign-in expired", 404);
  return ok(entry.status === "complete" ? { status: "complete", sourceId: entry.sourceId }
    : entry.status === "error" ? { status: "error", error: "Spotify sign-in failed; start again" } : { status: "pending" });
});

post("/api/sources/spotify/oauth/complete", async req => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  cleanup();
  const body = await readJson<{ state?: unknown; redirectUrl?: unknown }>(req);
  if (typeof body.state !== "string") return fail("Spotify sign-in expired", 404);
  const entry = pending.get(body.state);
  if (!entry || entry.did !== session.did || entry.jti !== session.jti) return fail("Spotify sign-in expired", 404);
  if (!entry.manualCallback || entry.status !== "pending") return fail("Spotify sign-in expired or already used", 400);
  if (typeof body.redirectUrl !== "string" || body.redirectUrl.length > 8192) return fail("Paste the final Spotify redirect URL");
  let url: URL;
  try { url = new URL(body.redirectUrl.trim()); } catch { return fail("Paste the entire final Spotify redirect URL"); }
  const expected = new URL(entry.redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash
    || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== body.state
    || url.searchParams.getAll("code").length > 1 || url.searchParams.getAll("error").length > 1
    || (url.searchParams.has("code") && url.searchParams.has("error"))) {
    return fail("Redirect URL does not match this Spotify sign-in");
  }
  return finishSignIn(req, entry, url.searchParams.get("code"));
});

get("/api/sources/spotify/oauth/callback", async req => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  cleanup();
  const entry = pending.get(req.url.searchParams.get("state") ?? "");
  if (!entry || entry.did !== session.did || entry.jti !== session.jti || entry.manualCallback || entry.status !== "pending") {
    return fail("Spotify sign-in expired or already used", 400);
  }
  return finishSignIn(req, entry, req.url.searchParams.get("code"));
});
