// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// Minimal AWS Sig v4 signer for S3 GET/HEAD/LIST operations.

interface SignParams {
  method: "GET" | "HEAD" | "PUT" | "POST" | "DELETE";
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  headers?: Record<string, string>;
  payloadHash?: string;
  service?: string;
}

const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data))
  );
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s)
  );
  return toHex(new Uint8Array(buf));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function uriEncode(input: string, allowSlash: boolean): string {
  let out = "";
  for (const ch of input) {
    if (
      (ch >= "A" && ch <= "Z") ||
      (ch >= "a" && ch <= "z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_" ||
      ch === "-" ||
      ch === "~" ||
      ch === "."
    ) {
      out += ch;
    } else if (ch === "/" && allowSlash) {
      out += "/";
    } else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) out += "%" + b.toString(16).padStart(2, "0").toUpperCase();
    }
  }
  return out;
}

export async function signRequest(params: SignParams): Promise<Headers> {
  const service = params.service ?? "s3";
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = params.payloadHash ?? EMPTY_PAYLOAD_HASH;

  const headers = new Headers(params.headers ?? {});
  headers.set("host", params.url.host);
  headers.set("x-amz-content-sha256", payloadHash);
  headers.set("x-amz-date", amzDate);

  const canonicalHeaderEntries: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    canonicalHeaderEntries.push([key.toLowerCase(), value.trim().replace(/\s+/g, " ")]);
  });
  canonicalHeaderEntries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders =
    canonicalHeaderEntries.map(([k, v]) => `${k}:${v}`).join("\n") + "\n";
  const signedHeaders = canonicalHeaderEntries.map(([k]) => k).join(";");

  const canonicalUri = uriEncode(decodeURIComponent(params.url.pathname), true);
  const sortedSearch = new URLSearchParams();
  const items: Array<[string, string]> = [];
  params.url.searchParams.forEach((v, k) => items.push([k, v]));
  items.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [k, v] of items) sortedSearch.append(k, v);
  const canonicalQuery = sortedSearch
    .toString()
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      const k = eq < 0 ? part : part.slice(0, eq);
      const v = eq < 0 ? "" : part.slice(eq + 1);
      return `${uriEncode(decodeURIComponent(k), false)}=${uriEncode(decodeURIComponent(v), false)}`;
    })
    .join("&");

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kSecret = new TextEncoder().encode(`AWS4${params.secretAccessKey}`);
  const kDate = await hmac(kSecret, dateStamp);
  const kRegion = await hmac(kDate, params.region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  headers.set(
    "Authorization",
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
  return headers;
}
