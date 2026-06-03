// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  issueSession,
  readCookie,
  sessionCookie,
  verifySession,
} from "../jwt.ts";

const secret = "test-secret-which-is-long-enough-to-be-an-hs256-key";

describe("jwt", () => {
  test("issue + verify round-trip", async () => {
    const token = await issueSession(secret, "dev-1", "full", 600);
    const claims = await verifySession(secret, token);
    expect(claims).toBeTruthy();
    expect(claims!.did).toBe("dev-1");
    expect(claims!.scope).toBe("full");
  });

  test("registration scope is preserved", async () => {
    const token = await issueSession(secret, "dev-2", "registration", 600);
    const claims = await verifySession(secret, token);
    expect(claims!.scope).toBe("registration");
  });

  test("tampered token verifies to null", async () => {
    const token = await issueSession(secret, "dev-3", "full", 600);
    const tampered = token.slice(0, -2) + "AA";
    const claims = await verifySession(secret, tampered);
    expect(claims).toBeNull();
  });

  test("readCookie extracts value among many", () => {
    const req = new Request("http://x/", {
      headers: { cookie: "a=1; jmmp_session=hello; b=2" },
    });
    expect(readCookie(req, "jmmp_session")).toBe("hello");
    expect(readCookie(req, "missing")).toBeNull();
  });

  test("sessionCookie includes Max-Age and SameSite", () => {
    const c = sessionCookie("jmmp_session", "tok", 3600, false);
    expect(c).toContain("Max-Age=3600");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).not.toContain("Secure");
  });
});
