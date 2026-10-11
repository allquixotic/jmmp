// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { test, expect } from "@playwright/test";
import { addVirtualAuthenticator } from "./webauthn";

test("Spotify default sign-in needs only an account and completes the pasted redirect", async ({ page, context }) => {
  await addVirtualAuthenticator(page, context);
  await page.goto("/login");
  const token = (await (await page.request.get("/api/auth/_debug/bootstrap-token")).json()).data.token as string;
  await page.getByLabel("Bootstrap token", { exact: false }).fill(token);
  await page.getByRole("button", { name: /Register passkey/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/sources");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByText("Spotify", { exact: true }).click();
  const dialog = page.getByRole("dialog");
  let oauthStarts = 0;
  page.on("request", request => { if (request.url().endsWith("/api/sources/spotify/oauth/start")) oauthStarts++; });
  await expect(dialog.getByText("You do not need to create a developer application.", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Application client ID (optional)")).not.toBeVisible();
  await expect(dialog.getByText("Connect your account once.", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Track, album or playlist links (one per line)")).toHaveCount(0);

  // Spotify itself is outside this UI test. Use the real jmmp start endpoint,
  // then replace the external provider and token completion at their boundaries.
  await context.route("https://accounts.spotify.com/authorize?**", route => route.fulfill({ contentType: "text/html", body: "<h1>Spotify sign-in</h1>" }));
  const startRequest = page.waitForRequest(request => request.url().endsWith("/api/sources/spotify/oauth/start"));
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Sign in to Spotify", exact: true }).click();
  const startBody = (await startRequest).postDataJSON();
  expect(startBody).not.toHaveProperty("clientId");
  expect(startBody).not.toHaveProperty("uris");
  const popup = await popupPromise;
  await popup.waitForURL("https://accounts.spotify.com/authorize?**");
  const authUrl = new URL(popup.url());
  expect(authUrl.searchParams.get("client_id")).toBe("65b708073fc0480ea92a077233ca87bd");
  expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
  await expect(dialog.getByRole("button", { name: "Finish connection" })).toBeDisabled();
  await expect(dialog.getByText("Copy that entire URL from the address bar", { exact: false })).toBeVisible();
  const callback = new URL(authUrl.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({ state: authUrl.searchParams.get("state")!, code: "ui-test-code" }).toString();
  await page.route("**/api/sources/spotify/oauth/complete", async route => {
    expect(route.request().postDataJSON()).toEqual({ state: authUrl.searchParams.get("state"), redirectUrl: callback.href });
    expect(route.request().headers()["x-jmmp-client"]).toBe("1");
    await route.fulfill({ json: { ok: true, data: { status: "complete", sourceId: 1 } } });
  });
  await dialog.getByLabel("Final redirect URL").fill(callback.href);
  await dialog.getByRole("button", { name: "Finish connection" }).click();
  await expect(dialog).not.toBeVisible();
  await popup.close();

  // Playlist import is a separate UI flow, with no second account sign-in.
  await page.getByRole("link", { name: "All playlists", exact: true }).click();
  await expect(page).toHaveURL(/\/playlists$/);
  await page.getByRole("button", { name: "Import Spotify playlist", exact: true }).click();
  await expect(dialog.getByText("Connect your Spotify account in Sources first.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.route("**/api/sources", route => route.fulfill({ json: { ok: true, data: { sources: [{
    id: 1, kind: "spotify", name: "My Spotify", config: { kind: "spotify", clientId: "65b708073fc0480ea92a077233ca87bd", redirectUri: "http://127.0.0.1:8898/login", uris: [] },
    fetchMode: "proxy", cachePolicy: "pin-only", lastScannedAt: null, createdAt: 1,
  }] } } }));
  const imported = { id: 42, name: "Imported collection", createdAt: 1, updatedAt: 1, pinnedAt: null, trackCount: 0, storage: { kind: "local", label: "jmmp server" } };
  let imports = 0;
  await page.route("**/api/playlists/import/spotify", async route => {
    expect(route.request().postDataJSON()).toEqual({ sourceId: 1, url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" });
    expect(route.request().headers()["x-jmmp-client"]).toBe("1");
    if (++imports === 1) await route.fulfill({ status: 202, json: { ok: true, data: { jobId: "ui-failure" } } });
    else await route.fulfill({ status: 202, json: { ok: true, data: { jobId: "ui-import" } } });
  });
  let failurePolls = 0;
  await page.route("**/api/playlists/import/spotify/ui-failure", route => {
    if (++failurePolls === 1) return route.fulfill({ json: { ok: true, data: { status: "pending", tracks: 14 } } });
    return route.fulfill({ status: 502, json: { ok: false, error: "Spotify playlist unavailable" } });
  });
  await page.route("**/api/playlists/import/spotify/ui-import", route => route.fulfill({ json: { ok: true, data: { status: "complete", playlist: imported, skippedTracks: 2 } } }));
  await page.route("**/api/playlists/42", route => route.fulfill({ json: { ok: true, data: { ...imported, tracks: [] } } }));
  await page.getByRole("button", { name: "Import Spotify playlist", exact: true }).click();
  await expect(dialog.getByText("Connected as My Spotify", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Import playlist", exact: true })).toBeDisabled();
  await dialog.getByLabel("Spotify playlist URL", { exact: true }).fill("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
  await dialog.getByRole("button", { name: "Import playlist", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Loaded 14 tracks…");
  await expect(dialog.getByText("Spotify playlist unavailable", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Import playlist", exact: true }).click();
  await expect(page).toHaveURL(/\/playlists\/42$/);
  await expect(page.getByRole("main").getByText("Imported collection", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").locator(".playlist-storage")).toContainText("jmmp server");
  await expect(page.getByText("Skipped 2 Spotify local files or unsupported items.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  expect(oauthStarts).toBe(1);
  expect(imports).toBe(2);
});
