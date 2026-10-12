// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createServer } from "node:net";
import { addVirtualAuthenticator, createVirtualAuthenticator } from "./webauthn";
import type { MoqOutputStatus, PasskeyListResponse, MeResponse } from "../shared/src/index.ts";

test("V37–V40 passkey label/role editing, ordinary stream shortcut and concurrent passive viewers", async ({ page, context, browser }) => {
  const recordMediaActions = () => {
    const handlers = new Map<string, MediaSessionActionHandler | null>();
    (window as any).__mediaActions = handlers;
    const original = navigator.mediaSession.setActionHandler;
    navigator.mediaSession.setActionHandler = function (action, handler) {
      handlers.set(action, handler); return original.call(this, action, handler);
    };
  };
  await context.addInitScript(recordMediaActions);
  const headers = { "X-jmmp-Client": "1" };
  const originalAuthenticator = await createVirtualAuthenticator(page, context);
  await page.goto("/login");
  const bootstrap = (await (await page.request.get("/api/auth/_debug/bootstrap-token")).json()).data.token as string;
  await page.getByLabel("Bootstrap token", { exact: false }).fill(bootstrap);
  await page.getByLabel("Passkey nickname", { exact: false }).fill("Owner");
  await page.getByRole("button", { name: "Register passkey", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const principal = (await (await page.request.get("/api/me")).json()).data as MeResponse;
  await page.goto("/settings/passkeys");
  await originalAuthenticator.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: originalAuthenticator.authenticatorId });
  await addVirtualAuthenticator(page, context);
  page.once("dialog", dialog => void dialog.accept("Backup admin"));
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByText("Backup admin", { exact: true })).toBeVisible();
  expect(((await (await page.request.get("/api/me")).json()).data as MeResponse).passkeyId).toBe(principal.passkeyId);
  page.once("dialog", dialog => void dialog.accept("Main controller"));
  await page.getByRole("button", { name: "Rename Owner", exact: true }).click();
  await expect(page.getByText("Main controller", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText("Main controller", { exact: true })).toBeVisible();

  const guests: BrowserContext[] = [];
  const enroll = async (label: string): Promise<Page> => {
    const result = await page.request.post("/api/auth/passkey/invitations", { headers, data: { label } });
    expect(result.status()).toBe(201);
    const url = (await result.json()).data.url as string;
    const ctx = await browser.newContext({ baseURL: "http://localhost:9001" }); guests.push(ctx);
    await ctx.addInitScript(recordMediaActions);
    const guest = await ctx.newPage(); await addVirtualAuthenticator(guest, ctx);
    await guest.goto(url); await guest.getByRole("button", { name: "Add my passkey", exact: true }).click();
    await expect(guest.getByText("Passkey added.", { exact: false })).toBeVisible();
    expect(((await (await guest.request.get("/api/me")).json()).data as MeResponse).role).toBe("admin");
    await guest.getByRole("link", { name: "Open player", exact: true }).click();
    return guest;
  };
  try {
    const guest = await enroll("Guest"), second = await enroll("Second viewer");
    await page.reload();
    const keys = (await (await page.request.get("/api/auth/passkeys")).json()).data as PasskeyListResponse;
    const guestKey = keys.passkeys.find(k => k.nickname === "Guest")!;
    const secondKey = keys.passkeys.find(k => k.nickname === "Second viewer")!;
    // Exercise the actual role picker and immediate changes to an existing JWT.
    await page.getByLabel("Role for Guest", { exact: true }).click();
    await page.getByRole("option", { name: "Viewer", exact: true }).click();
    await expect.poll(async () => ((await (await guest.request.get("/api/me")).json()).data as MeResponse).role).toBe("viewer");
    expect((await page.request.patch(`/api/auth/passkeys/${secondKey.id}`, { headers, data: { role: "viewer" } })).status()).toBe(200);
    expect((await page.request.post("/api/take-control", { headers })).status()).toBe(200);
    for (const viewer of [guest, second]) {
      await viewer.reload();
      await expect(viewer.getByRole("link", { name: "Sources", exact: true })).toHaveCount(0);
      await viewer.goto("/settings");
      await expect(viewer.getByText("MoQ output", { exact: true })).toHaveCount(0);
      await expect(viewer.getByText("Passkeys", { exact: true })).toHaveCount(0);
      expect((await viewer.request.get("/api/moq")).status()).toBe(403);
      expect((await viewer.request.get("/api/auth/passkeys")).status()).toBe(403);
      expect((await viewer.request.post("/api/take-control", { headers })).status()).toBe(403);
      const me = (await (await viewer.request.get("/api/me")).json()).data as MeResponse;
      expect(me.isPlayer).toBe(false); expect(me.playerConflict).toBeNull();
      await viewer.goto("/settings/passkeys"); await expect(viewer).toHaveURL(/\/$/);
    }
    expect(((await (await page.request.get("/api/me")).json()).data as MeResponse).isPlayer).toBe(true);
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => {
        const address = server.address(); if (!address || typeof address === "string") return reject(new Error("No test port"));
        server.close(() => resolve(address.port));
      });
    });
    const output = (await (await page.request.get("/api/moq")).json()).data as MoqOutputStatus;
    expect((await page.request.put("/api/moq", { headers, data: { ...output.settings, enabled: true, port, publicUrl: `http://localhost:${port}` } })).status()).toBe(200);
    try {
      await guest.goto("/");
      const shortcut = guest.getByRole("link", { name: "Listen to stream", exact: false });
      await expect(shortcut).toHaveAttribute("href", "/listen"); await expect(shortcut).toHaveAttribute("target", "_blank");
      const popupPromise = guest.waitForEvent("popup"); await shortcut.click(); const popup = await popupPromise;
      await expect(popup).toHaveURL(/\/listen$/); await expect(popup.getByRole("button", { name: "Listen", exact: true })).toBeVisible();
      await popup.close();
      const track = { id: 1, sourceId: 1, sourceTrackId: "fixture", title: "Observed track", artist: "Observed artist", album: "Album", durationMs: 100000, codec: "opus" };
      const playlist = { id: 42, name: "Passive playlist", createdAt: 1, updatedAt: 1, pinnedAt: null, tracks: [track], trackCount: 1, storage: { kind: "local", label: "jmmp server" } };
      await guest.route("**/api/playlists/42", route => route.fulfill({ json: { ok: true, data: playlist } }));
      await guest.route("**/api/playback", route => route.fulfill({ json: { ok: true, data: { ...output.playback, instanceId: "observer", state: "playing", trackId: 1, position: 12, duration: 100, currentTrack: track, nowPlaying: track } } }));
      const writes: string[] = []; guest.on("request", req => { if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) writes.push(req.method() + " " + new URL(req.url()).pathname); });
      await guest.goto("/playlists/42");
      await expect(guest.locator(".transport-bar")).toContainText("Observed track");
      await expect(guest.locator(".transport-bar")).toContainText("Observed artist");
      expect(await guest.evaluate(() => [...(window as any).__mediaActions.values()].every(handler => handler === null))).toBe(true);
      await expect(guest.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
      await guest.locator(".track-row").dblclick(); await guest.locator(".track-row").click({ button: "right" });
      await expect(guest.getByText("Add to playlist", { exact: true })).toHaveCount(0);
      await expect(guest.getByText("Remove from playlist", { exact: true })).toHaveCount(0);
      await guest.keyboard.press("Escape");
      const title = guest.getByRole("button", { name: "Title column", exact: true });
      const divider = guest.getByRole("separator", { name: "Resize Title column", exact: true });
      const before = (await title.boundingBox())!.width;
      await divider.focus(); await guest.keyboard.press("ArrowRight");
      await expect.poll(async () => (await title.boundingBox())!.width).toBeCloseTo(before + 10, 0);
      await guest.reload(); await expect.poll(async () => (await title.boundingBox())!.width).toBeCloseTo(before + 10, 0);
      await expect(guest.getByText("Another tab or device has player control.", { exact: true })).toHaveCount(0);
      expect(writes).toEqual([]);
      expect(((await (await page.request.get("/api/me")).json()).data as MeResponse).isPlayer).toBe(true);
      // A newly promoted controller can act on an existing stream without
      // selecting a track or opening an audio subscription on this device.
      expect((await page.request.patch(`/api/auth/passkeys/${guestKey.id}`, { headers, data: { role: "player" } })).status()).toBe(200);
      const controls: unknown[] = [];
      await guest.unroute("**/api/playback");
      let state = "playing";
      await guest.route("**/api/playback", async route => {
        if (route.request().method() === "POST") {
          controls.push(route.request().postDataJSON().command);
          state = "paused";
        }
        await route.fulfill({ json: { ok: true, data: { ...output.playback, instanceId: "controller", state, trackId: 1, position: 12, duration: 100, currentTrack: track, nowPlaying: track } } });
      });
      await guest.reload();
      await expect(guest.locator(".transport-bar")).toContainText("Observed track");
      await guest.locator(".transport-bar .play-btn").click();
      await expect.poll(() => controls).toEqual([{ type: "pause" }]);
      // The explicit UI action claimed ownership. OS controls now have the
      // same role/owner guard and use the ordinary server command path.
      await expect.poll(() => guest.evaluate(() => !!(window as any).__mediaActions.get("play"))).toBe(true);
      await expect.poll(() => guest.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
      await guest.evaluate(() => (window as any).__mediaActions.get("play")({ action: "play" }));
      await expect.poll(() => controls).toEqual([{ type: "pause" }, { type: "resume" }]);
      expect(((await (await guest.request.get("/api/me")).json()).data as MeResponse).isPlayer).toBe(true);
      expect(((await (await page.request.get("/api/me")).json()).data as MeResponse).isPlayer).toBe(false);
    } finally { await page.request.put("/api/moq", { headers, data: output.settings }); }
    expect((await page.request.patch(`/api/auth/passkeys/${guestKey.id}`, { headers, data: { role: "player" } })).status()).toBe(200);
    await guest.goto("/");
    expect((await guest.request.get("/api/stream/1")).status()).toBe(403);
    expect((await guest.request.post("/api/playlists", { headers, data: { name: "Denied" } })).status()).toBe(403);
    expect((await page.request.patch(`/api/auth/passkeys/${guestKey.id}`, { headers, data: { role: "dj" } })).status()).toBe(200);
    await guest.goto("/sources");
    await expect(guest.getByRole("link", { name: "Sources", exact: true })).toBeVisible();
    expect((await guest.request.post("/api/playlists", { headers, data: { name: "DJ playlist" } })).status()).toBe(201);
    expect((await guest.request.delete("/api/sources/999", { headers })).status()).toBe(403);
    expect((await page.request.patch(`/api/auth/passkeys/${guestKey.id}`, { headers, data: { role: "viewer" } })).status()).toBe(200);
    await guest.goto("/");
    await guest.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(guest).toHaveURL(/\/login$/);
    await guest.getByRole("button", { name: "Sign in with passkey", exact: true }).click();
    await expect(guest).toHaveURL(/\/$/);
    const signedIn = (await (await guest.request.get("/api/me")).json()).data as MeResponse;
    expect(signedIn.role).toBe("viewer"); expect(signedIn.passkeyId).toBe(guestKey.id);
  } finally { for (const ctx of guests) await ctx.close(); }
});
