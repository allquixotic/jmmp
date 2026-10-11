// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { test, expect, type BrowserContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ListenerPlaybackStatus, PlaybackStatus, PlaybackCommand } from "../shared/src/moq.ts";
import type { Track } from "../shared/src/source.ts";
let child: ChildProcess;
let fixture: { url: string; token: string; relayPort: number; publicUrl: string };
test.beforeAll(async () => {
  child = spawn("bun", ["e2e/moq-fixture.ts"], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout! });
  const [line] = await once(lines, "line"); lines.close(); fixture = JSON.parse(line);
});
test.afterAll(async () => { if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); } });
async function authenticate(context: BrowserContext, websocket = false, anonymous = false) {
  if (!anonymous) await context.addCookies([{ name: "jmmp_session", value: fixture.token, url: fixture.url }]);
  await context.addInitScript((forceWebSocket) => {
    if (forceWebSocket) Object.defineProperty(window, "WebTransport", { value: undefined });
    // Observe actual WebCodecs output, rather than treating catalog receipt as audio.
    const counters = { frames: 0, audible: false, opus: false, webtransport: false };
    (window as any).__moqAudio = counters;
    if (!forceWebSocket) {
      const NativeTransport = window.WebTransport;
      window.WebTransport = class extends NativeTransport {
        constructor(url: string | URL, options?: WebTransportOptions) {
          super(url, options); void this.ready.then(() => { counters.webtransport = true; }).catch(() => {});
        }
      };
    }
    const contexts: AudioContext[] = [];
    (window as any).__moqContexts = contexts;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(options); contexts.push(this); }
    };
    const NativeDecoder = window.AudioDecoder;
    window.AudioDecoder = class extends NativeDecoder {
      constructor(init: AudioDecoderInit) {
        super({ ...init, output(audio) {
          counters.frames += audio.numberOfFrames;
          const samples = new Float32Array(audio.numberOfFrames);
          audio.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
          if (samples.some(sample => Math.abs(sample) > .00001)) counters.audible = true;
          init.output(audio);
        } });
      }
      override configure(config: AudioDecoderConfig) { counters.opus ||= config.codec === "opus"; super.configure(config); }
    };
  }, websocket);
}
test("built jmmp uploads audio, tests the relay, and plays ordinary Opus subscribers over WT and WS", async ({ page, context, browser }) => {
  await authenticate(context);
  const headers = { "X-jmmp-Client": "1" };
  const upload = await page.request.post(fixture.url + "/api/sources/1/upload?path=tone.flac",
    { headers, data: await readFile(resolve("server/src/test/fixtures/tone.flac")) });
  expect(upload.ok()).toBe(true);
  const metadata = (await upload.json()).data.track;
  const catalog = await page.request.post(fixture.url + "/api/catalog/upload",
    { headers, data: { sourceId: 1, tracks: [metadata] } });
  expect(catalog.ok()).toBe(true);
  await page.goto(fixture.url + "/settings");
  await page.getByLabel("Relay URL for listeners", { exact: true }).fill("http://localhost:" + fixture.relayPort);
  await page.getByLabel("Relay port (TCP and UDP)", { exact: true }).fill(String(fixture.relayPort));
  await page.getByLabel("WebSocket fallback URL (optional)", { exact: true }).fill(fixture.publicUrl.replace("http:", "ws:") + "/moq");
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("successfully over webtransport", { timeout: 20000 });
  await page.getByRole("switch", { name: "Enable MoQ output" }).click();
  await page.getByRole("switch", { name: "Allow public, unauthenticated listening" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("MoQ settings saved");
  const fallback = await browser.newContext({ serviceWorkers: "block" });
  await authenticate(fallback, true, true);
  const subscriber = await fallback.newPage();
  let sourceRequests = 0;
  for (const client of [page, subscriber]) client.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/stream/")) sourceRequests++; });
  const errors: string[] = [];
  for (const client of [page, subscriber]) client.on("pageerror", error => errors.push(error.message));
  try {
    // The isolated listener accepts a browser with no session cookie. Media
    // flows through its WS proxy; private APIs remain absent on this socket.
    expect((await subscriber.request.get(fixture.publicUrl + "/api/sources")).status()).toBe(404);
    await subscriber.goto(fixture.publicUrl + "/public-listen");
    await expect(subscriber.getByText("Nothing playing right now.", { exact: true })).toBeVisible();
    // Public metadata updates without an audio subscription or credentials.
    // Keep this page disconnected while exercising track changes and recovery.
    const metadataPage = await fallback.newPage();
    const metadataRequests: string[] = [];
    metadataPage.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/") || path === "/moq") metadataRequests.push(request.method() + " " + path);
    });
    const idleStatus = (await (await subscriber.request.get(fixture.publicUrl + "/api/public/moq/status")).json()).data;
    let metadataStatus: ListenerPlaybackStatus = { ...idleStatus, state: "buffering", nowPlaying: { title: "Broadcast One", artist: "First Artist" } };
    let metadataFailure = false;
    await metadataPage.route("**/api/public/moq/status", route => route.fulfill({
      status: metadataFailure ? 503 : 200, contentType: "application/json",
      body: JSON.stringify(metadataFailure ? { ok: false, error: "Unavailable" } : { ok: true, data: metadataStatus }),
    }));
    await metadataPage.goto(fixture.publicUrl + "/public-listen");
    await expect(metadataPage.getByRole("heading", { name: "Broadcast One", exact: true })).toBeVisible();
    await expect(metadataPage.getByText("First Artist", { exact: true })).toBeVisible();
    metadataStatus = { ...metadataStatus, state: "paused", nowPlaying: { title: "Broadcast Two", artist: "Second Artist" } };
    await expect(metadataPage.getByRole("heading", { name: "Broadcast Two", exact: true })).toBeVisible();
    await expect(metadataPage.getByText("Second Artist", { exact: true })).toBeVisible();
    await expect(metadataPage.getByText("First Artist", { exact: true })).toHaveCount(0);
    metadataStatus = { ...metadataStatus, state: "ended", nowPlaying: null };
    await expect(metadataPage.getByText("Nothing playing right now.", { exact: true })).toBeVisible();
    metadataFailure = true;
    await expect(metadataPage.getByText("Could not load the current track. Retrying…", { exact: true })).toBeVisible();
    metadataFailure = false;
    metadataStatus = { ...metadataStatus, state: "playing", nowPlaying: { title: "Broadcast Three", artist: "Third Artist" } };
    await expect(metadataPage.getByRole("heading", { name: "Broadcast Three", exact: true })).toBeVisible();
    expect(await metadataPage.evaluate(() => (window as any).__moqAudio.frames)).toBe(0);
    expect(metadataRequests.length).toBeGreaterThan(1);
    expect(new Set(metadataRequests)).toEqual(new Set(["GET /api/public/moq/status"]));
    await metadataPage.close();
    await subscriber.getByRole("button", { name: "Listen", exact: true }).click({ timeout: 5000 });
    // Exercise the normal controlling player, not only the separate listener page.
    await page.goto(fixture.url + "/library/songs");
    await page.getByRole("button", { name: /Play Tone|Play tone|Play Untitled/ }).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__moqAudio.audible), { timeout: 15000 }).toBe(true);
    await expect.poll(() => subscriber.evaluate(() => (window as any).__moqAudio.audible), { timeout: 15000 }).toBe(true);
    expect(await page.evaluate(() => (window as any).__moqAudio.opus)).toBe(true);
    expect(await subscriber.evaluate(() => (window as any).__moqAudio.opus)).toBe(true);
    expect(await fallback.cookies()).toEqual([]);
    expect(await page.evaluate(() => (window as any).__moqAudio.webtransport)).toBe(true);
    for (const client of [page, subscriber]) expect(await client.evaluate(() => (window as any).__moqContexts.some((c: AudioContext) => c.state === "running"))).toBe(true);
    expect(sourceRequests).toBe(0);
    expect(errors).toEqual([]);
    // A restarted jmmp retains uploads/settings, but mints a new relay signing
    // key and certificate. Existing listeners must recover with fresh credentials.
    const before = (await (await page.request.get(fixture.url + "/api/playback")).json()).data.instanceId;
    const samples = await Promise.all([page, subscriber].map(client => client.evaluate(() => (window as any).__moqAudio.frames)));
    child.stdin!.write("restart\n");
    await expect.poll(async () => {
      try { return (await (await page.request.get(fixture.url + "/api/playback")).json()).data.instanceId; } catch { return before; }
    }, { timeout: 15000 }).not.toBe(before);
    await page.getByRole("button", { name: /Play Tone|Play tone|Play Untitled/ }).first().click();
    for (const [index, client] of [page, subscriber].entries()) {
      await expect.poll(() => client.evaluate(() => (window as any).__moqAudio.frames), { timeout: 20000 }).toBeGreaterThan(samples[index]! + 5000);
    }
    // Typed unavailability must advance the ordinary controlling MoQ player,
    // preserving its full diagnostic after the next track starts. The relay is
    // real; replace only the unavailable source/status boundary in this fixture.
    const song = (await (await page.request.get(fixture.url + "/api/catalog/tracks?source=1")).json()).data.tracks[0] as Track;
    const missing = { ...song, id: 999, sourceTrackId: "unavailable", title: "Unavailable fixture" };
    const playlistTracks = [missing, song];
    let queueTracks: typeof playlistTracks = [];
    await page.route("**/api/catalog/tracks**", route => route.fulfill({ json: { ok: true, data: { tracks: playlistTracks } } }));
    await page.route("**/api/queue", route => {
      if (route.request().method() === "PUT") queueTracks = playlistTracks;
      return route.fulfill({ json: { ok: true, data: { entries: queueTracks.map((track, position) => ({ position, track, addedAt: 1 })) } } });
    });
    let simulated = (await (await page.request.get(fixture.url + "/api/playback")).json()).data as PlaybackStatus;
    simulated = { ...simulated, generation: simulated.generation + 100, revision: simulated.revision + 100, trackId: null, state: "idle", error: null };
    let unavailablePending = false;
    const starts: number[] = [];
    const stack = "SpotifySourceError: unavailable for this account\n    at fetch(audio-worker.js:21:4)";
    await page.route("**/api/playback", route => {
      if (route.request().method() === "POST") {
        const { command } = route.request().postDataJSON() as { command: PlaybackCommand };
        if (command.type === "play") {
          starts.push(command.trackId);
          simulated = { ...simulated, trackId: command.trackId, state: "playing", error: null, generation: simulated.generation + 1, revision: simulated.revision + 1 };
          delete simulated.errorCode;
          unavailablePending = command.trackId === 999;
        }
      } else if (unavailablePending) {
        unavailablePending = false;
        simulated = { ...simulated, state: "error", error: stack, errorCode: "spotify_unavailable", generation: simulated.generation + 1, revision: simulated.revision + 1 };
      }
      return route.fulfill({ json: { ok: true, data: simulated } });
    });
    await page.goto(fixture.url + "/library/songs");
    await page.getByRole("button", { name: "Play Unavailable fixture", exact: true }).click();
    await expect.poll(() => starts).toEqual([999, song.id]);
    await page.getByText("Skipped tracks (1) — errors and stack traces", { exact: true }).click();
    await expect(page.locator(".diagnostics-history")).toContainText(stack);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.waitForTimeout(600); expect(starts).toEqual([999, song.id]);
    await page.unroute("**/api/playback"); await page.unroute("**/api/catalog/tracks**"); await page.unroute("**/api/queue");
    // Saving the disabled setting restores source playback and browser caching.
    await page.goto(fixture.url + "/settings");
    await page.getByRole("switch", { name: "Enable MoQ output" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("MoQ settings saved");
    await page.goto(fixture.url + "/library/songs");
    await page.getByRole("button", { name: /Play Tone|Play tone|Play Untitled/ }).first().click();
    await expect.poll(() => sourceRequests).toBeGreaterThan(0);
    const disabled = (await (await page.request.get(fixture.url + "/api/moq")).json()).data;
    expect(disabled.settings.enabled).toBe(false); expect(disabled.running).toBe(false);
    // Startup failures must be visible on the ordinary player's page, including
    // the compact transport. A failure must not become an unhandled click error.
    await page.route("**/api/moq", route => route.fulfill({status:503,contentType:"application/json",
      body:JSON.stringify({ok:false,error:"Playback service unavailable"})}));
    await page.getByRole("button", { name: /Play Tone|Play tone|Play Untitled/ }).first().click();
    await expect(page.getByRole("alert")).toContainText("Playback service unavailable");
    await page.setViewportSize({width:390,height:844});
    await expect(page.getByRole("alert")).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await fallback.close(); }
});
