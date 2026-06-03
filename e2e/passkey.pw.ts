// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "@playwright/test";
import { addVirtualAuthenticator } from "./webauthn";

// Drives the full passkey registration flow using Playwright's virtual
// authenticator via the Chrome DevTools Protocol.

test("bootstrap → virtual-authenticator register → land in app", async ({ page, context, browser: _browser }) => {
  const authenticatorId = await addVirtualAuthenticator(page, context);
  expect(authenticatorId).toBeTruthy();
  await page.goto("/login");

  const tokenResp = await page.request.get("/api/auth/_debug/bootstrap-token");
  expect(tokenResp.status()).toBe(200);
  const tokenBody = (await tokenResp.json()) as {
    ok: true;
    data: { token: string };
  };

  await page.getByLabel("Bootstrap token", { exact: false }).fill(tokenBody.data.token);
  await page.getByLabel("Passkey nickname", { exact: false }).fill("E2E passkey");
  await page.getByRole("button", { name: /Register passkey/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Start by adding a source")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".am-tabbar")).toBeVisible();
  await page.getByRole("tab", { name: /^Library$/ }).click();
  await expect(page).toHaveURL(/\/library\/albums$/);
  await page.getByRole("tab", { name: /^Search$/ }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.setViewportSize({ width: 1280, height: 720 });

  const createResp = await page.request.post("/api/playlists", {
    headers: { "X-jmmp-Client": "1" },
    data: { name: "Menu Check" },
  });
  expect(createResp.status()).toBe(201);
  const createBody = (await createResp.json()) as {
    ok: true;
    data: { id: number };
  };

  await page.goto(`/playlists/${createBody.data.id}`);
  await page.locator(".playlist-actions button").last().click();
  const menuLabels = page.locator(".q-menu .q-item__section--main");
  await expect(
    menuLabels.filter({ hasText: "Rename" })
  ).toBeVisible();
  await expect(
    menuLabels.filter({ hasText: "Delete" })
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const sourceResp = await page.request.post("/api/sources", {
    headers: { "X-jmmp-Client": "1" },
    data: {
      kind: "local",
      name: "Drag Source",
      config: { kind: "local", label: "Drag Source" },
    },
  });
  expect(sourceResp.status()).toBe(201);
  const sourceBody = (await sourceResp.json()) as {
    ok: true;
    data: { source: { id: number } };
  };
  const sourceId = sourceBody.data.source.id;

  const tracks = [
    { sourceId, sourceTrackId: "drag/1.mp3", title: "First Track", trackNo: 1 },
    { sourceId, sourceTrackId: "drag/2.mp3", title: "Second Track", trackNo: 2 },
    { sourceId, sourceTrackId: "drag/3.mp3", title: "Third Track", trackNo: 3 },
  ].map((track) => ({
    ...track,
    artist: "Tester",
    album: "Drag Album",
    durationMs: 60_000,
    codec: "mp3",
  }));
  const uploadResp = await page.request.post("/api/catalog/upload", {
    headers: { "X-jmmp-Client": "1" },
    data: { sourceId, tracks },
  });
  expect(uploadResp.status()).toBe(200);
  const trackResp = await page.request.get(`/api/catalog/tracks?source=${sourceId}`);
  expect(trackResp.status()).toBe(200);
  const trackBody = (await trackResp.json()) as {
    ok: true;
    data: { tracks: Array<{ id: number; title: string }> };
  };

  const dragPlaylistResp = await page.request.post("/api/playlists", {
    headers: { "X-jmmp-Client": "1" },
    data: { name: "Drag Check" },
  });
  expect(dragPlaylistResp.status()).toBe(201);
  const dragPlaylistBody = (await dragPlaylistResp.json()) as {
    ok: true;
    data: { id: number };
  };
  const dragPlaylistId = dragPlaylistBody.data.id;
  const appendResp = await page.request.post(
    `/api/playlists/${dragPlaylistId}/append`,
    {
      headers: { "X-jmmp-Client": "1" },
      data: { trackIds: trackBody.data.tracks.map((track) => track.id) },
    }
  );
  expect(appendResp.status()).toBe(200);

  const bulkPlaylistResp = await page.request.post("/api/playlists", {
    headers: { "X-jmmp-Client": "1" },
    data: { name: "Bulk Add Check" },
  });
  expect(bulkPlaylistResp.status()).toBe(201);
  const bulkPlaylistBody = (await bulkPlaylistResp.json()) as {
    ok: true;
    data: { id: number };
  };
  const bulkPlaylistId = bulkPlaylistBody.data.id;
  const albumPlaylistResp = await page.request.post("/api/playlists", {
    headers: { "X-jmmp-Client": "1" },
    data: { name: "Album Add Check" },
  });
  expect(albumPlaylistResp.status()).toBe(201);
  const albumPlaylistBody = (await albumPlaylistResp.json()) as {
    ok: true;
    data: { id: number };
  };
  const albumPlaylistId = albumPlaylistBody.data.id;

  const artistPlaylistResp = await page.request.post("/api/playlists", {
    headers: { "X-jmmp-Client": "1" },
    data: { name: "Artist Add Check" },
  });
  expect(artistPlaylistResp.status()).toBe(201);
  const artistPlaylistBody = (await artistPlaylistResp.json()) as {
    ok: true;
    data: { id: number };
  };
  const artistPlaylistId = artistPlaylistBody.data.id;

  await page.goto("/search?q=Track");
  const searchRows = page.locator(".track-row");
  await expect(searchRows).toHaveCount(3);
  await searchRows.nth(0).click();
  await expect(page.locator(".q-menu")).toHaveCount(0);
  await page.keyboard.down("Shift");
  await searchRows.nth(2).click();
  await page.keyboard.up("Shift");
  await expect(page.locator(".track-row.selected")).toHaveCount(3);

  await searchRows.nth(1).click({ button: "right" });
  await page.locator(".q-menu .q-item__section--main", { hasText: "Bulk Add Check" }).click();
  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/playlists/${bulkPlaylistId}`);
      const body = (await resp.json()) as {
        ok: true;
        data: { tracks: Array<{ title: string }> };
      };
      return body.data.tracks.map((track) => track.title);
    })
    .toEqual(["First Track", "Second Track", "Third Track"]);

  await page.goto("/library/albums");
  const albumCard = page.locator(".album-card", { hasText: "Drag Album" });
  await expect(albumCard).toHaveCount(1);
  await albumCard.click({ button: "right" });
  await expect(page.locator(".q-menu")).toContainText("Info");
  await expect(page.locator(".q-menu")).toContainText("Add album to playlist");
  await page.locator(".q-menu .q-item__section--main", { hasText: "Album Add Check" }).click();
  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/playlists/${albumPlaylistId}`);
      const body = (await resp.json()) as {
        ok: true;
        data: { tracks: Array<{ title: string }> };
      };
      return body.data.tracks.map((track) => track.title);
    })
    .toEqual(["First Track", "Second Track", "Third Track"]);

  await page.goto("/library/artists");
  const artistRow = page.locator(".artist-row", { hasText: "Tester" });
  await expect(artistRow).toHaveCount(1);
  await artistRow.click({ button: "right" });
  await expect(page.locator(".q-menu")).toContainText("Info");
  await expect(page.locator(".q-menu")).toContainText("Add artist to playlist");
  await page.locator(".q-menu .q-item__section--main", { hasText: "Artist Add Check" }).click();
  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/playlists/${artistPlaylistId}`);
      const body = (await resp.json()) as {
        ok: true;
        data: { tracks: Array<{ title: string }> };
      };
      return body.data.tracks.map((track) => track.title);
    })
    .toEqual(["First Track", "Second Track", "Third Track"]);

  await page.goto(`/playlists/${dragPlaylistId}`);
  const rows = page.locator(".track-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("First Track");
  await rows.nth(1).click();
  await expect(page.locator(".q-menu")).toHaveCount(0);

  const handleBox = await rows.nth(0).locator(".drag-handle").boundingBox();
  const targetBox = await rows.nth(2).boundingBox();
  expect(handleBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 8 }
  );
  await page.mouse.up();

  await expect(rows.nth(2)).toContainText("First Track");
  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/playlists/${dragPlaylistId}`);
      const body = (await resp.json()) as {
        ok: true;
        data: { tracks: Array<{ title: string }> };
      };
      return body.data.tracks.map((track) => track.title);
    })
    .toEqual(["Second Track", "Third Track", "First Track"]);
});
