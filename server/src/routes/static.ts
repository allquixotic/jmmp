// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// Serves the bundled client SPA. In the single-binary build the SPA is
// available through SPA_FILES (base64 strings codegenned at build time).
// In dev mode SPA_FILES is empty and we fall back to reading from
// client/dist/pwa (or /spa) on disk.

import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { setFallback, type Req } from "../router.ts";
import { candidateSpaDirs } from "../spa-paths.ts";
import { SPA_FILES } from "../spa-manifest.ts";

const SPA_DIR = resolveSpaDir();
const HAS_EMBEDDED = Object.keys(SPA_FILES).length > 0;

function resolveSpaDir(): string | null {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const c of candidateSpaDirs(here)) {
    if (existsSync(c)) return c;
  }
  return null;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

const decodeCache = new Map<string, Uint8Array>();

function decodeEmbedded(path: string): Uint8Array | null {
  const cached = decodeCache.get(path);
  if (cached) return cached;
  const b64 = SPA_FILES[path];
  if (!b64) return null;
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  decodeCache.set(path, bytes);
  return bytes;
}

function serveEmbedded(rel: string): Response | null {
  const bytes = decodeEmbedded(rel);
  if (!bytes) return null;
  return new Response(bytes, { headers: { "Content-Type": mimeFor(rel) } });
}

async function serveOnDisk(rel: string): Promise<Response | null> {
  if (!SPA_DIR) return null;
  const path = join(SPA_DIR, rel);
  if (!existsSync(path)) return null;
  return new Response(Bun.file(path), { headers: { "Content-Type": mimeFor(path) } });
}

setFallback(async (req: Req) => {
  const url = new URL(req.request.url);
  if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

  let rel = decodeURIComponent(url.pathname.replace(/^\//, "")) || "index.html";
  rel = normalize(rel);
  if (rel.includes("..")) return new Response("Bad path", { status: 400 });

  if (HAS_EMBEDDED) {
    const direct = serveEmbedded(rel);
    if (direct) return direct;
    const fallback = serveEmbedded("index.html");
    if (fallback) return fallback;
  }

  const direct = await serveOnDisk(rel);
  if (direct) return direct;
  const fallback = await serveOnDisk("index.html");
  return fallback ?? new Response("Not found", { status: 404 });
});
