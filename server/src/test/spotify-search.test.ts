// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchResponse } from "@jmmp/shared";
import { initDb } from "../db.ts";
import { encryptJson, loadOrInitMachineKey } from "../crypto.ts";
import { mintTestSession as mintSession } from "./session-fixture.ts";
import { dispatch, type AppCtx } from "../router.ts";
import * as runtime from "../audio/runtime.ts";
import * as spotify from "../sources/spotify.ts";
import "../routes/index.ts";

test("V29 Spotify live search reuses saved source, persists results and filters source/field", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jmmp-search-")), db = initDb(dir);
  const key = await loadOrInitMachineKey(dir);
  const config = { kind: "spotify" as const, clientId: "a".repeat(32), redirectUri: "http://127.0.0.1:8898/login", uris: [] };
  db.run("INSERT INTO sources(id,kind,name,config_json,creds_encrypted,cache_policy) VALUES (1,'spotify','Spotify',?,?,'none')", [JSON.stringify(config), await encryptJson(key, { kind: "spotify", accessToken: "saved", expiresAt: Date.now() + 3600000 })]);
  db.run("INSERT INTO sources(id,kind,name,config_json,cache_policy) VALUES (2,'local','Local','{}','none')");
  const ctx = { db, machineKey: key, cfg: { dataDir: dir, jwtSecret: "test", sessionTtlDays: 1, webauthn: { origin: "https://control.example.com" } } } as AppCtx;
  const session = await mintSession(ctx, "owner", "full");
  let queries = 0;
  const adapter = spyOn(spotify, "makeSpotifyAdapter").mockImplementation((usedDb, usedKey, sourceId, usedConfig) => {
    expect(usedDb).toBe(db); expect(usedKey).toBe(key); expect(sourceId).toBe(1); expect(usedConfig).toEqual(config);
    return { async *scan() {}, async fetch() { throw new Error("Search must not fetch audio"); }, async search(query, limit) {
      queries++; expect(query).toBe("Halloween"); expect(limit).toBe(50);
      return { tracks: [{ id: 0, sourceId: 1, sourceTrackId: "spotify:track:5sWHDYs0csV6RS48xBl0tH", title: "Halloween Theme", artist: "John Carpenter", album: "Halloween", durationMs: 120000, codec: "vorbis" }], albums: [], artists: [] };
    } };
  });
  const call = async (query: string, cookie = session.cookie) => dispatch(new Request("https://control.example.com/api/catalog/search?q=Halloween" + query, { headers: { cookie } }), ctx);
  try {
    expect((await call("", "")).status).toBe(401);
    const result = (await (await call("&source=1")).json() as { data: SearchResponse }).data;
    expect(result.fromSpotifyLive).toBe(true); expect(result.fromQobuzLive).toBe(false);
    expect(result.tracks[0]?.id).toBeGreaterThan(0);
    expect(result.albums[0]?.title).toBe("Halloween"); expect(result.artists[0]?.name).toBe("John Carpenter");
    const again = (await (await call("&source=1")).json() as { data: SearchResponse }).data;
    expect(again.tracks).toHaveLength(1); expect(again.tracks[0]?.id).toBe(result.tracks[0]?.id);
    const artist = (await (await call("&source=1&field=artist")).json() as { data: SearchResponse }).data;
    expect(artist.tracks).toHaveLength(0);
    const local = (await (await call("&source=2")).json() as { data: SearchResponse }).data;
    expect(local.tracks).toHaveLength(0); expect(queries).toBe(3);
    adapter.mockImplementation(() => ({ async *scan() {}, async fetch() { throw new Error(); }, async search() { throw new spotify.SpotifySourceError("search"); } }));
    const failed = (await (await call("&source=1")).json() as { data: SearchResponse }).data;
    expect(failed.sourceErrors).toEqual([{ sourceId: 1, error: "Spotify search failed; try again or reconnect this source in Sources" }]);
    expect(failed.tracks).toHaveLength(1); // Local snapshots still searchable on upstream failure.
  } finally { adapter.mockRestore(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});


test("V29 native search protocol bounds results and uses saved credentials only on stdin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jmmp-search-pipe-")), db = initDb(dir);
  const key = await loadOrInitMachineKey(dir);
  const config = { kind: "spotify" as const, clientId: "a".repeat(32), redirectUri: "http://127.0.0.1:8898/login", uris: [] };
  db.run("INSERT INTO sources(id,kind,name,config_json,creds_encrypted,cache_policy) VALUES (1,'spotify','Saved',?,?,'none')", [JSON.stringify(config), await encryptJson(key, { kind: "spotify", accessToken: "saved-private", expiresAt: Date.now() + 3600000 })]);
  const helper = join(dir, "helper");
  await Bun.write(helper, `#!${process.execPath}
const reader = Bun.stdin.stream().getReader();
const request = JSON.parse(new TextDecoder().decode((await reader.read()).value).split('\\n')[0]);
if (request.operation !== 'search' || request.accessToken !== 'saved-private' || request.query !== 'Halloween' || request.limit !== 2) process.exit(1);
for (const id of ['5sWHDYs0csV6RS48xBl0tH','5sWHDYs0csV6RS48xBl0tH','6sWHDYs0csV6RS48xBl0tH']) console.log(JSON.stringify({kind:'track',track:{sourceTrackId:'spotify:track:'+id,title:'Halloween',artist:'John Carpenter',album:'Halloween',codec:'vorbis',durationMs:1}}));
`);
  chmodSync(helper, 0o700);
  const assets = spyOn(runtime, "audioAssets").mockResolvedValue({ helper, worker: "unused" });
  try {
    const adapter = spotify.makeSpotifyAdapter(db, key, 1, config, dir);
    expect(await adapter.search!("Halloween", 2)).toMatchObject({ tracks: [{ id: 0, sourceId: 1 }, { id: 0, sourceId: 1 }] });
    await expect(adapter.search!("x", 2)).rejects.toThrow("Invalid Spotify search");
    await expect(adapter.search!("Halloween", 51)).rejects.toThrow("Invalid Spotify search");
  } finally { assets.mockRestore(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
