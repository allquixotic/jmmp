// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { shouldCacheAudio } from "../audio/cache-policy.ts";

describe("shouldCacheAudio", () => {
  test("caches all tracks when source policy is all", () => {
    expect(shouldCacheAudio("all", false)).toBe(true);
  });

  test("caches only pinned tracks for pin-only sources", () => {
    expect(shouldCacheAudio("pin-only", true)).toBe(true);
    expect(shouldCacheAudio("pin-only", false)).toBe(false);
  });

  test("never caches sources with cache disabled", () => {
    expect(shouldCacheAudio("none", true)).toBe(false);
  });
});
