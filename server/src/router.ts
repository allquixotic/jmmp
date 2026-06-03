// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { AppConfig } from "./config.ts";
import type { Database } from "bun:sqlite";

export interface AppCtx {
  cfg: AppConfig;
  db: Database;
  machineKey: CryptoKey;
}

export interface Req {
  request: Request;
  ctx: AppCtx;
  params: Record<string, string>;
  url: URL;
}

export type Handler = (req: Req) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: Handler;
}

const routes: Route[] = [];
let fallbackHandler: Handler | null = null;

export function on(method: string, path: string, handler: Handler): void {
  routes.push({ method, pattern: new URLPattern({ pathname: path }), handler });
}

export function setFallback(handler: Handler): void {
  fallbackHandler = handler;
}

export const get = (p: string, h: Handler) => on("GET", p, h);
export const post = (p: string, h: Handler) => on("POST", p, h);
export const put = (p: string, h: Handler) => on("PUT", p, h);
export const patch = (p: string, h: Handler) => on("PATCH", p, h);
export const del = (p: string, h: Handler) => on("DELETE", p, h);

export async function dispatch(request: Request, ctx: AppCtx): Promise<Response> {
  const url = new URL(request.url);
  if (requiresClientMutationHeader(request)) {
    return fail("missing client header", 403, "csrf");
  }
  for (const r of routes) {
    if (r.method !== request.method) continue;
    const m = r.pattern.exec({ pathname: url.pathname });
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.pathname.groups)) {
      if (typeof v === "string") params[k] = v;
    }
    try {
      return await r.handler({ request, ctx, params, url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`route error ${request.method} ${url.pathname}:`, err);
      return json({ ok: false, error: message }, { status: 500 });
    }
  }
  if (fallbackHandler && request.method === "GET") {
    try {
      return await fallbackHandler({ request, ctx, params: {}, url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`fallback error ${url.pathname}:`, err);
      return json({ ok: false, error: message }, { status: 500 });
    }
  }
  return new Response("not found", { status: 404 });
}

export function requiresClientMutationHeader(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return false;
  }
  const url = new URL(request.url);
  return url.pathname.startsWith("/api/") && request.headers.get("X-jmmp-Client") !== "1";
}

export function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as object) },
  });
}

export function ok<T>(data: T, init?: ResponseInit): Response {
  return json({ ok: true, data }, init);
}

export function fail(error: string, status = 400, code?: string): Response {
  return json({ ok: false, error, code }, { status });
}

export function readJson<T = unknown>(req: Req): Promise<T> {
  return req.request.json() as Promise<T>;
}
