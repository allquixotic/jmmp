// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "@playwright/test";
import { addVirtualAuthenticator } from "./webauthn";

// Smoke-test the unauthenticated auth status endpoint and the login page render.
// Full passkey flow requires Playwright's virtual authenticator and a tear-down
// step that wipes the server's data dir — gated behind a longer suite below.

test("login page renders with bootstrap token entry when no passkeys", async ({ page }) => {
  const resp = await page.request.get("/api/auth/status");
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as {
    ok: boolean;
    data: { hasPasskeys: boolean; hasBootstrapToken: boolean };
  };
  expect(body.ok).toBe(true);
  expect(body.data.hasPasskeys).toBe(false);
  expect(body.data.hasBootstrapToken).toBe(true);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("First-time setup")).toBeVisible();
  await expect(
    page.getByLabel("Bootstrap token", { exact: false })
  ).toBeVisible();
});

test("invalid bootstrap token shows error", async ({ page, context }) => {
  await addVirtualAuthenticator(page, context);
  await page.goto("/login");
  await page.getByLabel("Bootstrap token", { exact: false }).fill("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX");
  await page.getByRole("button", { name: /Register passkey/i }).click();
  await expect(page.locator(".bg-red-1").first()).toBeVisible({ timeout: 5000 });
});
