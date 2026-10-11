// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { configuredRequestOrigin, originList, shouldBindLocalHttpCompanion, withOrigin } from "../origins.ts";

describe("origin helpers", () => {
  test("OAuth callbacks preserve the configured public origin through TLS offload", () => {
    const origin = configuredRequestOrigin(new Request("http://control.example.com/api", { headers: { origin: "https://control.example.com", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" } }), ["http://localhost:9000", "https://control.example.com"]);
    expect(origin.origin).toBe("https://control.example.com");
    expect(() => configuredRequestOrigin(new Request("http://evil.example/api", { headers: { "x-forwarded-host": "control.example.com" } }), "https://control.example.com")).toThrow();
  });
  test("withOrigin preserves existing origins and appends once", () => {
    const origins = withOrigin(["http://localhost:9000"], "https://host.tailnet.ts.net:3000");

    expect(origins).toEqual(["http://localhost:9000", "https://host.tailnet.ts.net:3000"]);
    expect(withOrigin(origins, "https://host.tailnet.ts.net:3000")).toEqual(origins);
  });

  test("originList normalizes scalar origin config", () => {
    expect(originList("http://localhost:3000")).toEqual(["http://localhost:3000"]);
  });

  test("local HTTP companion only binds for loopback config moved to tailnet host", () => {
    expect(shouldBindLocalHttpCompanion("https", "127.0.0.1", "100.64.1.2")).toBe(true);
    expect(shouldBindLocalHttpCompanion("https", "127.0.0.1", "0.0.0.0")).toBe(false);
    expect(shouldBindLocalHttpCompanion("https", "0.0.0.0", "100.64.1.2")).toBe(false);
    expect(shouldBindLocalHttpCompanion("http", "127.0.0.1", "100.64.1.2")).toBe(false);
  });
});
