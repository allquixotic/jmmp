// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({ ...base, testMatch: "tables.pw.ts", testIgnore: [], outputDir: "../test-results/tables" });
