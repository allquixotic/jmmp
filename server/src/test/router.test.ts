// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { requiresClientMutationHeader } from "../router.ts";

describe("router", () => {
  test("requires client header for API mutations", () => {
    const req = new Request("http://localhost:3000/api/playlists", { method: "POST" });

    expect(requiresClientMutationHeader(req)).toBe(true);
  });

  test("allows safe methods and explicit client mutations", () => {
    expect(requiresClientMutationHeader(new Request("http://localhost:3000/api/catalog"))).toBe(
      false
    );
    expect(
      requiresClientMutationHeader(
        new Request("http://localhost:3000/api/playlists", {
          method: "POST",
          headers: { "X-jmmp-Client": "1" },
        })
      )
    ).toBe(false);
  });

  test("does not require the header outside the API", () => {
    const req = new Request("http://localhost:3000/assets/index.js", { method: "POST" });

    expect(requiresClientMutationHeader(req)).toBe(false);
  });
});
