// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { test, expect, type BrowserContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
let child: ChildProcess;
let fixture: { url: string; token: string; relayPort: number };
test.beforeAll(async () => {
  child = spawn("bun", ["e2e/moq-fixture.ts"], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout! });
  const [line] = await once(lines, "line"); lines.close(); fixture = JSON.parse(line);
});
test.afterAll(async () => { if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); } });
async function authenticate(context: BrowserContext, websocket = false) {
  await context.addCookies([{ name: "jmmp_session", value: fixture.token, url: fixture.url }]);
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
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("successfully over webtransport", { timeout: 20000 });
  await page.getByRole("switch", { name: "Enable MoQ output" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("MoQ settings saved");
  const fallback = await browser.newContext({ serviceWorkers: "block" });
  await authenticate(fallback, true);
  const subscriber = await fallback.newPage();
  let sourceRequests = 0;
  for (const client of [page, subscriber]) client.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/stream/")) sourceRequests++; });
  const errors: string[] = [];
  for (const client of [page, subscriber]) client.on("pageerror", error => errors.push(error.message));
  try {
    // The fallback GUI connection test must authenticate and subscribe over WS.
    await subscriber.goto(fixture.url + "/settings");
    await subscriber.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(subscriber.getByRole("status")).toContainText("successfully over websocket", { timeout: 15000 });
    await subscriber.goto(fixture.url + "/listen");
    await subscriber.getByRole("button", { name: "Listen", exact: true }).click({ timeout: 5000 });
    // Exercise the normal controlling player, not only the separate listener page.
    await page.goto(fixture.url + "/library/songs");
    await page.getByRole("button", { name: /Play Tone|Play tone|Play Untitled/ }).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__moqAudio.audible), { timeout: 15000 }).toBe(true);
    await expect.poll(() => subscriber.evaluate(() => (window as any).__moqAudio.audible), { timeout: 15000 }).toBe(true);
    expect(await page.evaluate(() => (window as any).__moqAudio.opus)).toBe(true);
    expect(await subscriber.evaluate(() => (window as any).__moqAudio.opus)).toBe(true);
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
  } finally { await fallback.close(); }
});
