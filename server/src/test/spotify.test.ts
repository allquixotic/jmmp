// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { test, expect, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { initDb } from "../db.ts";
import { loadOrInitMachineKey, encryptJson, decryptJson } from "../crypto.ts";
import { normalizeSpotifyUris, spotifyAccessToken, SpotifyPipe, SpotifySourceError } from "../sources/spotify.ts";
import { mintSession } from "../session.ts";
import { dispatch, type AppCtx } from "../router.ts";
import type { SourceSecrets } from "@jmmp/shared";
import "../routes/index.ts";
import { spotifyRedirectUri } from "../routes/spotify.ts";
import * as scanWorker from "../scan/worker.ts";
import { createHash } from "node:crypto";

const uri="spotify:track:5sWHDYs0csV6RS48xBl0tH";
test("Spotify callbacks use the configured HTTPS origin behind TLS offload", () => {
  const ctx = { cfg: { webauthn: { origin: "https://control.example.com" } } } as AppCtx;
  const req = (url: string, origin?: string) => ({ ctx, params: {}, url: new URL(url), request: new Request(url, { headers: origin ? { origin } : {} }) });
  expect(spotifyRedirectUri(req("http://control.example.com/api/sources/spotify/oauth/start", "https://control.example.com"))).toBe("https://control.example.com/api/sources/spotify/oauth/callback");
  expect(() => spotifyRedirectUri(req("http://evil.example/api", "https://control.example.com"))).toThrow();
  expect(() => spotifyRedirectUri(req("http://control.example.com/api", "https://evil.example"))).toThrow();
});
test("Spotify imports only canonical supported collections",()=>{
  expect(normalizeSpotifyUris([uri,"https://open.spotify.com/track/5sWHDYs0csV6RS48xBl0tH?si=test"])).toEqual([uri]);
  for(const values of [[],["https://evil.example/track/5sWHDYs0csV6RS48xBl0tH"],["spotify:episode:5sWHDYs0csV6RS48xBl0tH"],[42]])expect(()=>normalizeSpotifyUris(values)).toThrow();
});
test("Spotify schema upgrade preserves source children and deletion cascades",()=>{
  const dir=mkdtempSync(join(tmpdir(),"jmmp-spotify-upgrade-"));
  const old=new Database(join(dir,"jmmp.sqlite"),{create:true});
  old.exec("CREATE TABLE _schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL DEFAULT (unixepoch()))");
  const names=["initial","source_playlists","art_blobs","playlist_track_overlays","playlist_local_order","playlist_pinned","local_files"];
  for(const [index,name] of names.entries()){
    old.exec(readFileSync(join(import.meta.dir,`../migrations/000${index+1}_${name}.sql`),"utf8"));
    old.run("INSERT INTO _schema_migrations(version) VALUES (?)",[index+1]);
  }
  old.run("INSERT INTO sources(id,kind,name,config_json,cache_policy) VALUES (27,'local','existing','{}','none')");
  old.run("INSERT INTO tracks(id,source_id,source_track_id,title,codec) VALUES (81,27,'old.flac','Existing','flac')");
  old.run("INSERT INTO local_files VALUES (27,'old.flac','hash',400)");
  old.run("INSERT INTO playlists(id,name) VALUES (42,'Existing playlist')");
  old.run("INSERT INTO source_playlists(source_id,source_playlist_id,playlist_id) VALUES (27,'collection',42)");
  old.close();
  const db=initDb(dir);
  try{
    expect(db.query("SELECT title FROM tracks WHERE id=81").get()).toEqual({title:"Existing"});
    expect(db.query("SELECT source_id FROM local_files").get()).toEqual({source_id:27});
    expect(db.query("SELECT playlist_id FROM source_playlists").get()).toEqual({playlist_id:42});
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.run("INSERT INTO sources(kind,name,config_json,cache_policy) VALUES ('spotify','New','{}','pin-only')");
    db.run("DELETE FROM sources WHERE id=27");
    expect(db.query("SELECT 1 FROM tracks WHERE id=81").get()).toBeNull();
    expect(db.query("SELECT 1 FROM local_files").get()).toBeNull();
    expect(db.query("SELECT 1 FROM source_playlists").get()).toBeNull();
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test("Spotify refresh is serialized and stored encrypted without losing refresh token",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"jmmp-spotify-token-")),db=initDb(dir),key=await loadOrInitMachineKey(dir);
  const config={kind:"spotify" as const,clientId:"a".repeat(32),redirectUri:"https://music.example.com/api/sources/spotify/oauth/callback",uris:[uri]};
  db.run("INSERT INTO sources(id,kind,name,config_json,creds_encrypted,cache_policy) VALUES (1,'spotify','test',?,?,'pin-only')",[JSON.stringify(config),await encryptJson(key,{kind:"spotify",accessToken:"expired-secret",refreshToken:"refresh-secret",expiresAt:0})]);
  const mock=spyOn(globalThis,"fetch").mockImplementation(Object.assign(async(input: Parameters<typeof fetch>[0],init?: Parameters<typeof fetch>[1])=>{
    expect(String(input)).toBe("https://accounts.spotify.com/api/token");expect(String(init?.body)).toContain("grant_type=refresh_token");
    await Bun.sleep(10);return Response.json({access_token:"new-secret",expires_in:3600});
  }, { preconnect: fetch.preconnect }));
  try{
    expect(await Promise.all([spotifyAccessToken(db,key,1,config),spotifyAccessToken(db,key,1,config)])).toEqual(["new-secret","new-secret"]);
    expect(mock).toHaveBeenCalledTimes(1);
    const row=db.query<{creds_encrypted:Uint8Array},[]>("SELECT creds_encrypted FROM sources WHERE id=1").get()!;
    expect(new TextDecoder().decode(row.creds_encrypted)).not.toContain("new-secret");
    const secret=await decryptJson<SourceSecrets>(key,row.creds_encrypted);expect(secret.kind).toBe("spotify");
    if(secret.kind==="spotify")expect(secret.refreshToken).toBe("refresh-secret");
    expect(await spotifyAccessToken(db,key,1,config)).toBe("new-secret");expect(mock).toHaveBeenCalledTimes(1);
  }finally{mock.mockRestore();db.close();rmSync(dir,{recursive:true,force:true});}
});
test("Spotify OAuth state belongs to its initiating session and is single-use",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"jmmp-spotify-oauth-")),db=initDb(dir);
  const ctx={cfg:{dataDir:dir,jwtSecret:"test",sessionTtlDays:1,webauthn:{origin:"https://music.example.com"}},db,machineKey:await loadOrInitMachineKey(dir)} as AppCtx;
  const owner=await mintSession(ctx,"owner","full"),other=await mintSession(ctx,"other","full");
  const call=(path:string,cookie:string,body?:unknown)=>dispatch(new Request("https://music.example.com"+path,{method:body?"POST":"GET",headers:{cookie,"X-jmmp-Client":"1"},body:body?JSON.stringify(body):undefined}),ctx);
  try{
    expect((await call("/api/sources/spotify/oauth/start","",{})).status).toBe(401);
    const start=await call("/api/sources/spotify/oauth/start",owner.cookie,{clientId:"a".repeat(32),uris:[uri]});
    const result=(await start.json() as {data:{state:string;authUrl:string}}).data;
    const url=new URL(result.authUrl);expect(url.hostname).toBe("accounts.spotify.com");expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(url.searchParams.has("code_verifier")).toBe(false);
    expect((await call(`/api/sources/spotify/oauth/status/${result.state}`,other.cookie)).status).toBe(404);
    expect((await call(`/api/sources/spotify/oauth/callback?state=${result.state}&error=access_denied`,other.cookie)).status).toBe(400);
    expect((await call(`/api/sources/spotify/oauth/callback?state=${result.state}&error=access_denied`,owner.cookie)).status).toBe(502);
    expect((await call(`/api/sources/spotify/oauth/callback?state=${result.state}&code=replay`,owner.cookie)).status).toBe(400);
    expect(db.query("SELECT 1 FROM sources").get()).toBeNull();
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test("V14 Spotify built-in sign-in needs no developer app and binds pasted callback to its owner",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"jmmp-spotify-default-oauth-")),db=initDb(dir);
  const ctx={cfg:{dataDir:dir,jwtSecret:"test",sessionTtlDays:1,webauthn:{origin:"https://music.example.com"}},db,machineKey:await loadOrInitMachineKey(dir)} as AppCtx;
  const owner=await mintSession(ctx,"owner","full"),other=await mintSession(ctx,"other","full");
  const call=(path:string,cookie:string,body?:unknown)=>dispatch(new Request("https://music.example.com"+path,{method:body?"POST":"GET",headers:{cookie,"X-jmmp-Client":"1"},body:body?JSON.stringify(body):undefined}),ctx);
  try {
    const start=await call("/api/sources/spotify/oauth/start",owner.cookie,{uris:[uri]});
    expect(start.status).toBe(200);
    const result=(await start.json() as {data:{state:string;authUrl:string;manualCallback:boolean;redirectUri:string}}).data;
    const authUrl=new URL(result.authUrl);
    expect(result.manualCallback).toBe(true);
    expect(result.redirectUri).toBe("http://127.0.0.1:8898/login");
    expect(authUrl.searchParams.get("client_id")).toBe("65b708073fc0480ea92a077233ca87bd");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(result.redirectUri);
    expect(authUrl.searchParams.get("scope")).toBe("streaming");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.has("code_verifier")).toBe(false);
    const callback=new URL(result.redirectUri);callback.search=new URLSearchParams({state:result.state,code:"test-code"}).toString();
    const body={state:result.state,redirectUrl:callback.href};
    expect((await call("/api/sources/spotify/oauth/complete","",body)).status).toBe(401);
    expect((await call("/api/sources/spotify/oauth/complete",other.cookie,body)).status).toBe(404);
    expect((await call(`/api/sources/spotify/oauth/callback?state=${result.state}&code=wrong-flow`,owner.cookie)).status).toBe(400);
    for (const redirectUrl of [callback.href.replace("127.0.0.1","evil.example"),callback.href.replace(":8898",":8899"),callback.href.replace("/login","/other"),callback.href.replace(result.state,"wrong-state"),callback.href+"#unexpected",callback.href+"&state="+result.state,callback.href+"&code=duplicate",callback.href+"&error=access_denied"])
      expect((await call("/api/sources/spotify/oauth/complete",owner.cookie,{...body,redirectUrl})).status).toBe(400);
    const denied=new URL(result.redirectUri);denied.search=new URLSearchParams({state:result.state,error:"access_denied"}).toString();
    expect((await call("/api/sources/spotify/oauth/complete",owner.cookie,{...body,redirectUrl:denied.href})).status).toBe(502);
    expect((await call("/api/sources/spotify/oauth/complete",owner.cookie,body)).status).toBe(400);
    expect(db.query("SELECT 1 FROM sources").get()).toBeNull();
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test("V14 Spotify built-in login exchanges PKCE once and saves encrypted refresh credentials",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"jmmp-spotify-default-complete-")),db=initDb(dir);
  const ctx={cfg:{dataDir:dir,jwtSecret:"test",sessionTtlDays:1,webauthn:{origin:"https://music.example.com"}},db,machineKey:await loadOrInitMachineKey(dir)} as AppCtx;
  const owner=await mintSession(ctx,"owner","full");
  const call=(path:string,body?:unknown)=>dispatch(new Request("https://music.example.com"+path,{method:body?"POST":"GET",headers:{cookie:owner.cookie,"X-jmmp-Client":"1"},body:body?JSON.stringify(body):undefined}),ctx);
  const scan=spyOn(scanWorker,"runScan").mockResolvedValue(undefined);
  let challenge="";
  const token=spyOn(globalThis,"fetch").mockImplementation(Object.assign(async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
    expect(String(input)).toBe("https://accounts.spotify.com/api/token");
    const params=new URLSearchParams(String(init?.body));
    expect(params.get("client_id")).toBe("65b708073fc0480ea92a077233ca87bd");
    expect(params.get("redirect_uri")).toBe("http://127.0.0.1:8898/login");
    expect(params.get("code")).toBe("test-code");
    expect(createHash("sha256").update(params.get("code_verifier")!).digest("base64url")).toBe(challenge);
    await Bun.sleep(5);
    return Response.json({access_token:"private-access",refresh_token:"private-refresh",expires_in:3600});
  },{preconnect:fetch.preconnect}));
  try{
    const start=await call("/api/sources/spotify/oauth/start",{clientId:"",sourceName:"My Spotify"});
    const result=(await start.json() as {data:{state:string;authUrl:string;redirectUri:string}}).data;
    challenge=new URL(result.authUrl).searchParams.get("code_challenge")!;
    const callback=new URL(result.redirectUri);callback.search=new URLSearchParams({state:result.state,code:"test-code"}).toString();
    const body={state:result.state,redirectUrl:callback.href};
    const responses=await Promise.all([call("/api/sources/spotify/oauth/complete",body),call("/api/sources/spotify/oauth/complete",body)]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,400]);
    expect(token).toHaveBeenCalledTimes(1);expect(scan).not.toHaveBeenCalled();
    const row=db.query<{id:number;name:string;config_json:string;creds_encrypted:Uint8Array;fetch_mode:string},[]>("SELECT id,name,config_json,creds_encrypted,fetch_mode FROM sources").get()!;
    expect(row.name).toBe("My Spotify");expect(row.fetch_mode).toBe("proxy");
    expect(JSON.parse(row.config_json)).toEqual({kind:"spotify",clientId:"65b708073fc0480ea92a077233ca87bd",redirectUri:result.redirectUri,uris:[]});
    expect(new TextDecoder().decode(row.creds_encrypted)).not.toContain("private-access");
    expect(new TextDecoder().decode(row.creds_encrypted)).not.toContain("private-refresh");
    const secrets=await decryptJson<SourceSecrets>(ctx.machineKey,row.creds_encrypted);
    expect(secrets.kind).toBe("spotify");
    if(secrets.kind==="spotify"){expect(secrets.accessToken).toBe("private-access");expect(secrets.refreshToken).toBe("private-refresh");}
    const status=(await (await call(`/api/sources/spotify/oauth/status/${result.state}`)).json() as {data:unknown}).data;
    expect(status).toEqual({status:"complete",sourceId:row.id});
    expect((await call("/api/sources/spotify/oauth/complete",body)).status).toBe(400);
  }finally{token.mockRestore();scan.mockRestore();db.close();rmSync(dir,{recursive:true,force:true});}
});
test("Spotify pipe preserves audio after a split header and propagates cancellation",async()=>{
  const child=Bun.spawn([process.execPath,"-e",'process.stdout.write("{\\\"size\\\":4}\\n");process.stdout.write(Buffer.from([0,1,2,3]));setInterval(()=>{},1000)'],{stdin:"pipe",stdout:"pipe",stderr:"ignore"});
  const pipe=new SpotifyPipe(child);child.stdin.end();
  try{
    expect(await pipe.line()).toEqual({size:4});
    const reader=pipe.audio().getReader();expect((await reader.read()).value).toEqual(new Uint8Array([0,1,2,3]));
    await reader.cancel();await child.exited;expect(child.signalCode).toBeTruthy();
  }finally{pipe.close();}
});
test("Spotify pipe rejects failed downloads instead of treating truncation as EOF",async()=>{
  const child=Bun.spawn([process.execPath,"-e",'process.stdout.write("{}\\n");process.exit(1)'],{stdin:"pipe",stdout:"pipe",stderr:"ignore"});
  const pipe=new SpotifyPipe(child);child.stdin.end();
  try{await pipe.line();await expect(new Response(pipe.audio()).arrayBuffer()).rejects.toThrow("Spotify audio download failed");}finally{pipe.close();}
});
test("V19 Spotify native errors are mapped to fixed messages rather than raw diagnostics",async()=>{
  for (const code of ["login", "playlist", "unknown-secret-https://secret.example"]) {
    const child=Bun.spawn([process.execPath,"-e",`process.stdout.write(JSON.stringify({kind:"error",code:${JSON.stringify(code)},message:"private-refresh"})+"\\n");process.exit(1)`],{stdin:"pipe",stdout:"pipe",stderr:"ignore"});
    const pipe=new SpotifyPipe(child);
    try {
      await expect(pipe.line()).rejects.toThrow(new SpotifySourceError(code).message);
      expect(new SpotifySourceError(code).message).not.toContain("secret");
    } finally {pipe.close();await child.exited;}
  }
});
