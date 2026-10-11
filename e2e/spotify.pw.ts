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
  await expect(dialog.getByText("You do not need to create a developer application.", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Application client ID (optional)")).not.toBeVisible();
  await dialog.getByLabel("Track, album or playlist links (one per line)").fill("https://open.spotify.com/track/5sWHDYs0csV6RS48xBl0tH");

  // Spotify itself is outside this UI test. Use the real jmmp start endpoint,
  // then replace the external provider and token completion at their boundaries.
  await context.route("https://accounts.spotify.com/authorize?**", route => route.fulfill({ contentType: "text/html", body: "<h1>Spotify sign-in</h1>" }));
  const startRequest = page.waitForRequest(request => request.url().endsWith("/api/sources/spotify/oauth/start"));
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Sign in to Spotify", exact: true }).click();
  expect((await startRequest).postDataJSON()).not.toHaveProperty("clientId");
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
});
