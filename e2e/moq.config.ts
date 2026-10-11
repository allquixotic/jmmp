// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./", testMatch: "moq.pw.ts", workers: 1, timeout: 60000,
  reporter: [["list"]], use: { ...devices["Desktop Chrome"], serviceWorkers: "block", trace: "retain-on-failure" },
});
