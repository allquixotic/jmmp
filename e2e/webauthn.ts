// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { BrowserContext, Page } from "@playwright/test";

export async function addVirtualAuthenticator(
  page: Page,
  context: BrowserContext
): Promise<string> {
  return (await createVirtualAuthenticator(page, context)).authenticatorId;
}

export async function createVirtualAuthenticator(page: Page, context: BrowserContext) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const auth = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return { cdp, authenticatorId: auth.authenticatorId as string };
}
