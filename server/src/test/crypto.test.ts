// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  bytesEqual,
  decryptJson,
  encryptJson,
  generateBootstrapToken,
  sha256,
} from "../crypto.ts";

async function makeKey(): Promise<CryptoKey> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

describe("crypto helpers", () => {
  test("encrypt/decrypt round-trip preserves JSON", async () => {
    const key = await makeKey();
    const value = { secret: "shh", nested: { n: 42 } };
    const blob = await encryptJson(key, value);
    const back = await decryptJson<typeof value>(key, blob);
    expect(back).toEqual(value);
  });

  test("encrypt produces distinct ciphertexts for the same plaintext", async () => {
    const key = await makeKey();
    const a = await encryptJson(key, "hello");
    const b = await encryptJson(key, "hello");
    expect(bytesEqual(a, b)).toBe(false);
  });

  test("bootstrap token has 8 4-char groups and stable hash", async () => {
    const t = generateBootstrapToken();
    expect(t.split("-").length).toBe(8);
    for (const g of t.split("-")) expect(g.length).toBe(4);
    const h1 = await sha256(t);
    const h2 = await sha256(t);
    expect(bytesEqual(h1, h2)).toBe(true);
  });

  test("sha256 differs for distinct inputs", async () => {
    const a = await sha256("alpha");
    const b = await sha256("beta");
    expect(bytesEqual(a, b)).toBe(false);
  });
});
