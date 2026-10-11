// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { test, expect, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { initDb } from "../db.ts";
import { loadOrInitMachineKey, encryptJson, decryptJson } from "../crypto.ts";
import { normalizeSpotifyUris, spotifyAccessToken, SpotifyPipe } from "../sources/spotify.ts";
import { mintSession } from "../session.ts";
import { dispatch, type AppCtx } from "../router.ts";
import type { SourceSecrets } from "@jmmp/shared";
import "../routes/index.ts";
import { spotifyRedirectUri } from "../routes/spotify.ts";

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
