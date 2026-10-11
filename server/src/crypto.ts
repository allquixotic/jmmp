// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const MACHINE_KEY_FILE = ".machine_key";

export async function loadOrInitMachineKey(dataDir: string): Promise<CryptoKey> {
  const path = join(dataDir, MACHINE_KEY_FILE);
  let raw: Uint8Array<ArrayBuffer>;
  if (existsSync(path)) {
    raw = new Uint8Array(readFileSync(path));
    if (raw.byteLength !== 32) {
      throw new Error(`${path} must be 32 bytes (got ${raw.byteLength})`);
    }
  } else {
    raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    writeFileSync(path, raw, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
  );
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(ct, iv.byteLength);
  return out;
}

export async function decrypt(key: CryptoKey, blob: Uint8Array): Promise<string> {
  if (blob.byteLength < 13) throw new Error("encrypted blob too short");
  const owned = new Uint8Array(blob);
  const iv = owned.subarray(0, 12);
  const ct = owned.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function encryptJson<T>(key: CryptoKey, value: T): Promise<Uint8Array> {
  return encrypt(key, JSON.stringify(value));
}

export async function decryptJson<T>(key: CryptoKey, blob: Uint8Array): Promise<T> {
  return JSON.parse(await decrypt(key, blob));
}

const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateBootstrapToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  return out.match(/.{1,4}/g)!.join("-");
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const buf =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
