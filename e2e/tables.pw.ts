// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { test, expect } from "@playwright/test";
import { addVirtualAuthenticator } from "./webauthn";

test("V30 table dividers resize with mouse/touch/keys; header menus persist across views and reloads", async ({ page, context }) => {
  await addVirtualAuthenticator(page, context);
  await page.goto("/login");
  const token = (await (await page.request.get("/api/auth/_debug/bootstrap-token")).json()).data.token as string;
  await page.getByLabel("Bootstrap token", { exact: false }).fill(token);
  await page.getByRole("button", { name: /Register passkey/i }).click();
  await expect(page).toHaveURL(/\/$/);
  const tracks = [1, 2, 3].map(id => ({ id, sourceId: 1, sourceTrackId: `fixture-${id}`, title: `Track ${id}`, artist: "Artist", album: "Album", durationMs: 1000, codec: "flac" }));
  const playlist = { id: 42, name: "Table fixture", createdAt: 1, updatedAt: 1, pinnedAt: null, tracks, trackCount: 3, storage: { kind: "local", label: "jmmp server" } };
  await page.route("**/api/playlists/42", route => route.fulfill({ json: { ok: true, data: playlist } }));
  await page.route("**/api/catalog/search?**", route => route.fulfill({ json: { ok: true, data: { tracks, albums: [], artists: [], fromQobuzLive: false, fromSpotifyLive: true } } }));
  await page.goto("/playlists/42");
  const title = page.getByRole("button", { name: "Title column", exact: true });
  const divider = page.getByRole("separator", { name: "Resize Title column", exact: true });
  await expect(title).toBeVisible();
  const before = (await title.boundingBox())!.width;
  const bounds = (await divider.boundingBox())!;
  const tableBounds = (await page.locator(".track-list-table").boundingBox())!;
  expect(bounds.height).toBeCloseTo(tableBounds.height, 0);
  expect(await divider.evaluate(element => getComputedStyle(element, "::after").width)).toBe("1px");
  const rowY = bounds.y + bounds.height - 20;
  await page.mouse.move(bounds.x + bounds.width / 2, rowY);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 85, rowY, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await title.boundingBox())!.width).toBeCloseTo(before + 85, 0);
  await divider.focus(); await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await title.boundingBox())!.width).toBeCloseTo(before + 95, 0);

  // Use real Chromium touch input to exercise capture and movement off the line.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const touchBounds = (await divider.boundingBox())!, x = touchBounds.x + 6, y = touchBounds.y + 10;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 35, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await title.boundingBox())!.width).toBeCloseTo(before + 130, 0);
  const artist = page.getByRole("button", { name: "Artist column", exact: true });
  await artist.click({ button: "right" });
  await page.getByText("Hide Artist column", { exact: true }).click();
  await expect(artist).toHaveCount(0);
  await expect(page.locator(".td-artist")).toHaveCount(0);
  await page.reload();
  await expect(artist).toHaveCount(0);
  await expect.poll(async () => (await title.boundingBox())!.width).toBeCloseTo(before + 130, 0);
  await page.goto("/search?q=Track");
  await expect(page.locator(".track-row")).toHaveCount(3);
  await expect(artist).toHaveCount(0);
  const headerBounds = (await title.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: headerBounds.x + 30, y: headerBounds.y + 10 }] });
  await expect(page.getByText("Hide Title column", { exact: true })).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.getByText("Hide Title column", { exact: true }).click();
  await expect(title).toHaveCount(0);
  // Wait for the touch menu to release its focus trap before focusing a header.
  await expect(page.locator(".column-context-menu")).toHaveCount(0);
  const album = page.getByRole("button", { name: "Album column", exact: true });
  await album.focus(); await expect(album).toBeFocused(); await page.keyboard.press("Shift+F10");
  await page.getByText("Reset column layout", { exact: true }).click();
  await expect(title).toBeVisible(); await expect(artist).toBeVisible();
  await page.reload(); await expect(title).toBeVisible(); await expect(artist).toBeVisible();
});
