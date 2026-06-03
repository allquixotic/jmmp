// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { isRemoteArtReference } from "../storage/art-cache.ts";

describe("art cache references", () => {
  test("treats Qobuz image URLs as directly renderable art", () => {
    expect(isRemoteArtReference("https://static.qobuz.com/images/covers/a.jpg")).toBe(
      true
    );
    expect(isRemoteArtReference("http://static.qobuz.com/images/covers/a.jpg")).toBe(
      true
    );
    expect(isRemoteArtReference("/api/art/" + "a".repeat(64))).toBe(true);
    expect(isRemoteArtReference("f00dbeef")).toBe(false);
  });
});
