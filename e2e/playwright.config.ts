// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: "*.pw.ts",
  testIgnore: ["moq.pw.ts", "spotify.pw.ts", "invitations.pw.ts", "tables.pw.ts", "rbac.pw.ts"],
  outputDir: "../test-results/standard",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:9001",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "cd .. && rm -rf e2e/.e2e-data && JMMP_E2E_DEBUG=1 JMMP_CONFIG=e2e/jmmp.e2e.yml bun server/src/main.ts",
      port: 3000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "cd .. && bun --cwd=client run dev -- --port 9001",
      port: 9001,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
