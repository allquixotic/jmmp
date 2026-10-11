// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes } from "node:crypto";
import { get, post, ok, fail, readJson, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";
import { encryptJson } from "../crypto.ts";
import { normalizeSpotifyUris, spotifyTokenRequest } from "../sources/spotify.ts";
import { runScan } from "../scan/worker.ts";

interface Pending {
  did: string; jti: string; created: number; clientId: string; redirectUri: string;
  verifier: string; uris: string[]; name: string; status: "pending" | "exchanging" | "complete" | "error";
  sourceId?: number;
}
const pending = new Map<string, Pending>();
function cleanup() { for (const [state, value] of pending) if (Date.now()-value.created > 600000) pending.delete(state); }
export function spotifyRedirectUri(req: Req): string {
  const configured = req.ctx.cfg.webauthn.origin;
  const origins = typeof configured === "string" ? [configured] : configured;
  if (!origins.includes(req.url.origin)) throw new Error("Spotify callback must use a configured jmmp origin");
  if (req.url.protocol !== "https:" && !["127.0.0.1", "[::1]"].includes(req.url.hostname)) throw new Error("Spotify requires HTTPS or a loopback IP callback");
  return `${req.url.origin}/api/sources/spotify/oauth/callback`;
}
post("/api/sources/spotify/oauth/start", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  cleanup();
  try {
    const body = await readJson<{ clientId: string; sourceName?: string; uris: string[] }>(req);
    if (!/^[a-fA-F0-9]{32}$/.test(body.clientId)) return fail("Spotify application client ID required");
    if (pending.size >= 100) return fail("Too many pending sign-ins",429);
    const state=randomBytes(32).toString("base64url"), verifier=randomBytes(64).toString("base64url");
    const redirectUri=spotifyRedirectUri(req);
    const entry: Pending = { did:session.did,jti:session.jti,created:Date.now(),clientId:body.clientId,redirectUri,verifier,
      uris:normalizeSpotifyUris(body.uris),name:body.sourceName?.trim().slice(0,200)||"Spotify",status:"pending" };
    pending.set(state,entry);
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ client_id:entry.clientId,response_type:"code",redirect_uri:redirectUri,state,
      code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url"),
      scope:"streaming user-read-private user-read-email playlist-read-private playlist-read-collaborative" }).toString();
    return ok({ state,authUrl:url.href });
  } catch (error) { return fail(error instanceof Error ? error.message : "Invalid Spotify configuration"); }
});
get("/api/sources/spotify/oauth/status/:state", async req => {
  const session=await requireFullSession(req); if(session instanceof Response)return session;
  cleanup(); const entry=pending.get(req.params.state!);
  if (!entry || entry.did!==session.did || entry.jti!==session.jti) return fail("Spotify sign-in expired",404);
  return ok(entry.status === "complete" ? {status:"complete",sourceId:entry.sourceId} : entry.status==="error" ? {status:"error",error:"Spotify sign-in failed; start again"} : {status:"pending"});
});
get("/api/sources/spotify/oauth/callback", async req => {
  const session=await requireFullSession(req); if(session instanceof Response)return session;
  cleanup(); const entry=pending.get(req.url.searchParams.get("state")??"");
  if (!entry || entry.did!==session.did || entry.jti!==session.jti || entry.status!=="pending") return fail("Spotify sign-in expired or already used",400);
  entry.status="exchanging";
  try {
    const code=req.url.searchParams.get("code"); if(!code)throw new Error("Spotify authorization denied");
    const secrets=await spotifyTokenRequest(new URLSearchParams({ grant_type:"authorization_code",code,client_id:entry.clientId,redirect_uri:entry.redirectUri,code_verifier:entry.verifier }));
    if(!secrets.refreshToken)throw new Error("Spotify refresh credential missing");
    const config={kind:"spotify",clientId:entry.clientId,redirectUri:entry.redirectUri,uris:entry.uris};
    const encrypted=await encryptJson(req.ctx.machineKey,secrets);
    const insert=req.ctx.db.run("INSERT INTO sources(kind,name,config_json,creds_encrypted,fetch_mode,cache_policy) VALUES ('spotify',?,?,?,'proxy','pin-only')",[entry.name,JSON.stringify(config),encrypted]);
    entry.sourceId=Number(insert.lastInsertRowid); entry.status="complete"; entry.verifier="";
    void runScan(req.ctx.db,req.ctx.machineKey,entry.sourceId,{extractMetadata:false});
    return new Response('<!doctype html><html><head><meta charset="utf-8"><title>Spotify connected</title></head><body><h1>Spotify connected</h1><p>Return to jmmp. Your music is being indexed.</p></body></html>',{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  } catch { entry.status="error"; entry.verifier=""; return fail("Spotify sign-in failed; start again",502); }
});
