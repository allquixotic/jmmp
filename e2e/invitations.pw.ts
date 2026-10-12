// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";
import { addVirtualAuthenticator } from "./webauthn";

test("V21/V22/V23/V41 admin-default and viewer-only invitations register and sign in with their assigned roles", async ({ page, context, browser }) => {
  await addVirtualAuthenticator(page, context);
  await page.goto("/login");
  const bootstrap = (await (await page.request.get("/api/auth/_debug/bootstrap-token")).json()).data.token as string;
  await page.getByLabel("Bootstrap token", { exact: false }).fill(bootstrap);
  await page.getByLabel("Passkey nickname", { exact: false }).fill("Owner");
  await page.getByRole("button", { name: "Register passkey", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByText("Passkeys", { exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/passkeys$/);
  await expect(page.getByLabel("Invitation role", { exact: true })).toHaveValue("Admin");
  await page.getByLabel("Invitation label (optional)").fill("Guest");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const link = await dialog.getByLabel("Invitation link", { exact: true }).inputValue();
  expect(new URL(link).pathname).toBe("/invite");
  expect(new URL(link).search).toBe("");
  await expect(dialog.getByRole("img", { name: "Passkey invitation QR code" })).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();

  const recipient = await browser.newContext({ baseURL: "http://localhost:9001" });
  try {
    const guest = await recipient.newPage();
    await addVirtualAuthenticator(guest, recipient);
    expect((await guest.request.get("/api/playlists")).status()).toBe(401);
    await guest.goto(link);
    await expect(guest.getByRole("button", { name: "Add my passkey", exact: true })).toBeVisible();
    await expect(guest.getByText("Admin access", { exact: true })).toBeVisible();
    expect((await guest.request.get("/api/playlists")).status()).toBe(401);
    await guest.reload(); // Opening and reloading do not burn the invitation.
    await expect(guest.getByRole("button", { name: "Add my passkey", exact: true })).toBeVisible();
    await guest.getByLabel("Passkey nickname (optional)").fill("Guest's passkey");
    await guest.getByRole("button", { name: "Add my passkey", exact: true }).click();
    await expect(guest.getByText("Passkey added.", { exact: false })).toBeVisible();
    expect((await guest.request.get("/api/playlists")).status()).toBe(200);
    expect((await (await guest.request.get("/api/me")).json()).data.role).toBe("admin");
    await guest.getByRole("link", { name: "Open player", exact: true }).click();
    await expect(guest).toHaveURL(/\/$/);
    await guest.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(guest).toHaveURL(/\/login$/);
    await guest.getByRole("button", { name: "Sign in with passkey", exact: true }).click();
    await expect(guest).toHaveURL(/\/$/);
    await guest.goto(link);
    await expect(guest.getByText("already used", { exact: false })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Add my passkey", exact: true })).toHaveCount(0);
  } finally { await recipient.close(); }

  await page.reload();
  await expect(page.getByText("Guest's passkey", { exact: true })).toBeVisible();
  await expect(page.getByText("Used · expires", { exact: false })).toBeVisible();
  await page.getByLabel("Invitation label (optional)").fill("Revoked guest");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const revokedLink = await dialog.getByLabel("Invitation link", { exact: true }).inputValue();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Revoke invitation Revoked guest", exact: true }).click();
  await expect(page.getByText("Revoked · expires", { exact: false })).toBeVisible();
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto(revokedLink);
    await expect(visitor.getByText("revoked", { exact: false })).toBeVisible();
    await expect(visitor.getByRole("button", { name: "Add my passkey", exact: true })).toHaveCount(0);
  } finally { await anonymous.close(); }

  await page.getByLabel("Invitation label (optional)").fill("Passive listener");
  await page.getByLabel("Invitation role", { exact: true }).click();
  await page.getByRole("option", { name: "Viewer", exact: true }).click();
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(dialog).toContainText("Viewer access");
  const viewerLink = await dialog.getByLabel("Invitation link", { exact: true }).inputValue();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Invitation role", { exact: true })).toHaveValue("Admin");
  await expect(page.locator(".q-item").filter({ has: page.getByText("Passive listener", { exact: true }) })).toContainText("Viewer · Available");
  const viewerContext = await browser.newContext({ baseURL: "http://localhost:9001" });
  try {
    const viewer = await viewerContext.newPage();
    await addVirtualAuthenticator(viewer, viewerContext);
    await viewer.goto(viewerLink);
    await expect(viewer.getByText("Viewer access", { exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "Add my passkey", exact: true }).click();
    await expect(viewer.getByText("Passkey added.", { exact: false })).toBeVisible();
    const me = (await (await viewer.request.get("/api/me")).json()).data;
    expect(me.role).toBe("viewer"); expect(me.isPlayer).toBe(false); expect(me.playerConflict).toBeNull();
    const headers = { "X-jmmp-Client": "1" };
    expect((await viewer.request.get("/api/auth/passkeys")).status()).toBe(403);
    expect((await viewer.request.get("/api/moq")).status()).toBe(403);
    expect((await viewer.request.post("/api/take-control", { headers })).status()).toBe(403);
    expect((await viewer.request.post("/api/auth/passkey/invitations", { headers, data: { role: "admin" } })).status()).toBe(403);
    await viewer.getByRole("link", { name: "Open player", exact: true }).click();
    await expect(viewer).toHaveURL(/\/$/);
    await expect(viewer.getByRole("link", { name: "Sources", exact: true })).toHaveCount(0);
    await viewer.getByRole("button", { name: "Sign out", exact: true }).click();
    await viewer.getByRole("button", { name: "Sign in with passkey", exact: true }).click();
    await expect(viewer).toHaveURL(/\/$/);
    expect((await (await viewer.request.get("/api/me")).json()).data.role).toBe("viewer");
    await viewer.goto(viewerLink);
    await expect(viewer.getByText("already used", { exact: false })).toBeVisible();
  } finally { await viewerContext.close(); }
});
