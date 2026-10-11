// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

// This flow registers its own passkey against a fresh server database.
// Keep it separate from the standard suite's shared authentication fixture.
export default defineConfig({
  ...baseConfig,
  testMatch: "spotify.pw.ts",
  testIgnore: "moq.pw.ts",
  outputDir: "../test-results/spotify",
});
