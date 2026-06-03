// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

import { scannedDurationMs } from "../scan/worker.ts";

describe("scan worker metadata preservation", () => {
  test("treats zero scanned duration as unknown so enrichment can preserve real duration", () => {
    expect(scannedDurationMs(0)).toBeNull();
    expect(scannedDurationMs(undefined)).toBeNull();
    expect(scannedDurationMs(335_634)).toBe(335_634);
  });
});
