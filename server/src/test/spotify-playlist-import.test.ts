// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Playlist, PlaylistWithTracks, ScanEvent, SourceConfig, Track } from "@jmmp/shared";
import { initDb } from "../db.ts";
import { encryptJson, loadOrInitMachineKey } from "../crypto.ts";
import { dispatch, type AppCtx } from "../router.ts";
import { mintSession } from "../session.ts";
import * as spotify from "../sources/spotify.ts";
import { getScanProgress, runScan } from "../scan/worker.ts";
import { spotifyPlaylistUri } from "../spotify-playlist-import.ts";
import type { ServerSourceAdapter } from "../sources/types.ts";
import "../routes/index.ts";

const playlistUri = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M";
const playlistUrl = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=share";
const a: Omit<Track, "id"> = { sourceId: 1, sourceTrackId: "spotify:track:5sWHDYs0csV6RS48xBl0tH", title: "First", artist: "Artist", album: "Album", codec: "vorbis", durationMs: 123000 };
const b: Omit<Track, "id"> = { ...a, sourceTrackId: "spotify:track:6sWHDYs0csV6RS48xBl0tH", title: "Second" };

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jmmp-spotify-import-")), db = initDb(dir);
  const key = await loadOrInitMachineKey(dir);
  const config: Extract<SourceConfig, { kind: "spotify" }> = { kind: "spotify", clientId: "65b708073fc0480ea92a077233ca87bd", redirectUri: "http://127.0.0.1:8898/login", uris: [] };
  const encrypted = await encryptJson(key, { kind: "spotify", accessToken: "saved-access", refreshToken: "saved-refresh", expiresAt: Date.now() + 3600000 });
  db.run("INSERT INTO sources(id,kind,name,config_json,creds_encrypted,fetch_mode,cache_policy) VALUES (1,'spotify','Saved Spotify',?,?,'proxy','pin-only')", [JSON.stringify(config), encrypted]);
  db.run("INSERT INTO sources(id,kind,name,config_json,cache_policy) VALUES (2,'qobuz','Other service','{}','pin-only')");
  const ctx = { cfg: { dataDir: dir, jwtSecret: "test", sessionTtlDays: 1, webauthn: { origin: "https://control.example.com" } }, db, machineKey: key } as AppCtx;
  const owner = await mintSession(ctx, "owner", "full");
  const call = (path: string, body?: unknown, method = body ? "POST" : "GET", cookie = owner.cookie) => dispatch(new Request("https://control.example.com" + path, {
    method, headers: { cookie, "X-jmmp-Client": "1" }, body: body ? JSON.stringify(body) : undefined,
  }), ctx);
  async function waitForImport(jobId: string): Promise<Response> {
    for (let i = 0; i < 100; i++) {
      const response = await call(`/api/playlists/import/spotify/${jobId}`);
      if (response.status !== 200) return response;
      const result = await response.clone().json() as { data: { status: string } };
      if (result.data.status !== "pending") return response;
      await Bun.sleep(1);
    }
    throw new Error("Import did not finish");
  }
  async function importPlaylist(): Promise<Response> {
    const start = await call("/api/playlists/import/spotify", { sourceId: 1, url: playlistUrl });
    expect(start.status).toBe(202);
    const { data } = await start.json() as { data: { jobId: string } };
    return waitForImport(data.jobId);
  }
  return { dir, db, key, config, encrypted, ctx, owner, call, importPlaylist, waitForImport, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function metadata(tracks: Array<Omit<Track, "id">>, after?: () => void): ServerSourceAdapter {
  return {
    async *scan() {
      for (const track of tracks) yield { kind: "add", track } as ScanEvent;
      yield { kind: "playlist", sourcePlaylistId: playlistUri, name: "Imported collection", tracks } as ScanEvent;
      after?.();
    },
    async fetch() { throw new Error("Import must not download audio"); },
  };
}

test("V16 playlist URL validation rejects tracks and arbitrary hosts", () => {
  expect(spotifyPlaylistUri(playlistUrl)).toBe(playlistUri);
  expect(spotifyPlaylistUri(playlistUri)).toBe(playlistUri);
  for (const value of [undefined, 42, "https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M", a.sourceTrackId, "https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M"])
    expect(() => spotifyPlaylistUri(value)).toThrow();
});

test("V16 native imports reuse saved credentials, retain order/duplicates, and survive a rescan", async () => {
  const f = await fixture();
  const adapter = spyOn(spotify, "makeSpotifyAdapter").mockImplementation((db, key, sourceId, config, dataDir) => {
    expect(db).toBe(f.db); expect(key).toBe(f.key); expect(sourceId).toBe(1); expect(dataDir).toBe(f.dir);
    expect(config).toEqual({ ...f.config, uris: [playlistUri] });
    return metadata([a, b, a]);
  });
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => { throw new Error("No new account authorization"); }, { preconnect: fetch.preconnect }));
  try {
    for (let i = 0; i < 2; i++) {
      const response = await f.importPlaylist();
      expect(response.status).toBe(200);
      const playlist = (await response.json() as { data: { status: "complete"; playlist: Playlist } }).data.playlist;
      expect(playlist.storage).toEqual({ kind: "local", label: "jmmp server" });
      expect(playlist.name).toBe("Imported collection"); expect(playlist.trackCount).toBe(3);
      const details = (await (await f.call(`/api/playlists/${playlist.id}`)).json() as { data: PlaylistWithTracks }).data;
      expect(details.tracks.map(t => t.sourceTrackId)).toEqual([a.sourceTrackId, b.sourceTrackId, a.sourceTrackId]);
      expect(details.tracks[0]!.id).toBe(details.tracks[2]!.id);
      expect((await f.call(`/api/playlists/${playlist.id}`, { name: "My local edit", trackIds: [details.tracks[1]!.id, details.tracks[0]!.id] }, "PATCH")).status).toBe(200);
    }
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(f.db.query("SELECT COUNT(*) AS n FROM tracks").get()).toEqual({ n: 2 });
    expect(f.db.query("SELECT COUNT(*) AS n FROM playlists").get()).toEqual({ n: 2 });
    expect(f.db.query("SELECT 1 FROM source_playlists").get()).toBeNull();
    expect(f.db.query<{ creds_encrypted: Uint8Array; config_json: string }, []>("SELECT creds_encrypted,config_json FROM sources WHERE id=1").get()).toEqual({ creds_encrypted: f.encrypted, config_json: JSON.stringify(f.config) });
    adapter.mockRestore();
    await runScan(f.db, f.key, 1, { extractMetadata: false });
    expect(getScanProgress(1)?.state).toBe("idle");
    expect(f.db.query("SELECT title FROM tracks ORDER BY id").all()).toEqual([{ title: "First" }, { title: "Second" }]);
    expect(f.db.query("SELECT name FROM playlists ORDER BY id").all()).toEqual([{ name: "My local edit" }, { name: "My local edit" }]);
    expect(f.db.query("SELECT COUNT(*) AS n FROM playlist_tracks").get()).toEqual({ n: 4 });
    expect(network).not.toHaveBeenCalled();
  } finally { adapter.mockRestore(); network.mockRestore(); f.close(); }
});

test("V16 import requires an authenticated saved Spotify connection", async () => {
  const f = await fixture();
  const adapter = spyOn(spotify, "makeSpotifyAdapter").mockReturnValue(metadata([a]));
  try {
    expect((await f.call("/api/playlists/import/spotify", { sourceId: 1, url: playlistUrl }, "POST", "")).status).toBe(401);
    expect((await dispatch(new Request("https://control.example.com/api/playlists/import/spotify", { method: "POST", headers: { cookie: f.owner.cookie }, body: "{}" }), f.ctx)).status).toBe(403);
    for (const sourceId of [0, -1, 1.1, "1", undefined])
      expect((await f.call("/api/playlists/import/spotify", { sourceId, url: playlistUrl })).status).toBe(400);
    expect((await f.call("/api/playlists/import/spotify", { sourceId: 2, url: playlistUrl })).status).toBe(404);
    expect((await f.call("/api/playlists/import/spotify", { sourceId: 999, url: playlistUrl })).status).toBe(404);
    expect((await f.call("/api/playlists/import/spotify", { sourceId: 1, url: a.sourceTrackId })).status).toBe(400);
    expect(adapter).not.toHaveBeenCalled();
  } finally { adapter.mockRestore(); f.close(); }
});

test("V16 failed or incomplete metadata leaves no partial native playlist or tracks", async () => {
  const f = await fixture();
  const adapter = spyOn(spotify, "makeSpotifyAdapter").mockReturnValue(metadata([a], () => { throw new Error("Download failed after playlist metadata"); }));
  try {
    expect((await f.importPlaylist()).status).toBe(502);
    expect(f.db.query("SELECT 1 FROM tracks").get()).toBeNull();
    expect(f.db.query("SELECT 1 FROM playlists").get()).toBeNull();
    adapter.mockReturnValue({ async *scan() { yield { kind: "add", track: a }; }, async fetch() { throw new Error("Unused"); } });
    expect((await f.importPlaylist()).status).toBe(502);
    expect(f.db.query("SELECT 1 FROM tracks").get()).toBeNull();
    adapter.mockReturnValue(metadata([a, { ...b, sourceTrackId: "invalid" }]));
    expect((await f.importPlaylist()).status).toBe(502);
    expect(f.db.query("SELECT 1 FROM tracks").get()).toBeNull();
    expect(f.db.query("SELECT 1 FROM playlists").get()).toBeNull();
  } finally { adapter.mockRestore(); f.close(); }
});

test("V16 empty playlist creates an editable native snapshot", async () => {
  const f = await fixture(), adapter = spyOn(spotify, "makeSpotifyAdapter").mockReturnValue(metadata([]));
  try {
    const response = await f.importPlaylist();
    expect(response.status).toBe(200);
    const playlist = (await response.json() as { data: { status: "complete"; playlist: Playlist } }).data.playlist;
    expect(playlist.trackCount).toBe(0); expect(playlist.storage.kind).toBe("local");
  } finally { adapter.mockRestore(); f.close(); }
});

test("V17 background import returns promptly, binds status to its session and rejects overlap", async () => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const adapter = spyOn(spotify, "makeSpotifyAdapter").mockReturnValue({
    async *scan() { yield { kind: "add", track: a }; await held; yield { kind: "playlist", sourcePlaylistId: playlistUri, name: "Background snapshot", tracks: [a] }; },
    async fetch() { throw new Error("Unused"); },
  });
  try {
    const start = await f.call("/api/playlists/import/spotify", { sourceId: 1, url: playlistUrl });
    expect(start.status).toBe(202);
    const { data } = await start.json() as { data: { jobId: string } };
    const status = `/api/playlists/import/spotify/${data.jobId}`;
    expect((await (await f.call(status)).json() as { data: unknown }).data).toEqual({ status: "pending", tracks: 1 });
    const other = await mintSession(f.ctx, "other", "full");
    expect((await f.call(status, undefined, "GET", other.cookie)).status).toBe(404);
    expect((await f.call(status, undefined, "GET", "")).status).toBe(401);
    expect((await f.call("/api/playlists/import/spotify", { sourceId: 1, url: playlistUrl })).status).toBe(409);
    expect(f.db.query("SELECT 1 FROM playlists").get()).toBeNull();
    release();
    expect((await f.waitForImport(data.jobId)).status).toBe(200);
    expect(f.db.query("SELECT name FROM playlists").get()).toEqual({ name: "Background snapshot" });
  } finally { release(); adapter.mockRestore(); f.close(); }
});

test("V19 failed background import exposes a safe actionable error without native secrets", async () => {
  const f = await fixture();
  const adapter = spyOn(spotify, "makeSpotifyAdapter").mockReturnValue({
    async *scan() { throw new spotify.SpotifySourceError("login"); yield { kind: "add", track: a }; },
    async fetch() { throw new Error("Unused"); },
  });
  try {
    const response = await f.importPlaylist();
    expect(response.status).toBe(502);
    expect((await response.json() as { error: string }).error).toBe("Spotify login failed; reconnect this source in Sources");
    adapter.mockReturnValue({
      async *scan() { throw new Error("private-access private-refresh https://secret.example/?token=secret"); yield { kind: "add", track: a }; },
      async fetch() { throw new Error("Unused"); },
    });
    const unexpected = await f.importPlaylist();
    const body = await unexpected.text();
    expect(body).not.toContain("private-"); expect(body).not.toContain("secret.example");
    expect(f.db.query("SELECT 1 FROM playlists").get()).toBeNull();
  } finally { adapter.mockRestore(); f.close(); }
});

test("V20 mixed Spotify playlists import supported music and report skipped items", async () => {
  const f = await fixture();
  const adapter = spyOn(spotify, "makeSpotifyAdapter").mockReturnValue({
    async *scan() {
      for (const track of [a, b, a]) yield { kind: "add", track } as ScanEvent;
      yield { kind: "playlist", sourcePlaylistId: playlistUri, name: "Mixed collection", tracks: [a, b, a], skippedTracks: 2 } as ScanEvent;
    },
    async fetch() { throw new Error("No audio fetch during import"); },
  });
  try {
    const response = await f.importPlaylist();
    expect(response.status).toBe(200);
    const result = (await response.json() as { data: { status: string; playlist: Playlist; skippedTracks: number } }).data;
    expect(result.skippedTracks).toBe(2); expect(result.playlist.trackCount).toBe(3);
    expect(result.playlist.storage.kind).toBe("local");
  } finally { adapter.mockRestore(); f.close(); }
});
