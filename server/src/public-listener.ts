// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { Server, ServerWebSocket } from "bun";
import { DEFAULT_DSP_PARAMS, type ListenerPlaybackStatus } from "@jmmp/shared";
import { playbackController } from "./audio/controller.ts";
import { ok, fail, type AppCtx } from "./router.ts";
import { serveStatic } from "./routes/static.ts";

interface ProxyData { upstream: WebSocket; pending: Array<string | ArrayBuffer>; bytes: number }

/** An independent listener socket cannot dispatch any controller route. */
export async function publicRequest(request: Request, ctx: AppCtx, server?: Server<ProxyData>): Promise<Response | undefined> {
  const url = new URL(request.url), playback = playbackController(ctx);
  if (!playback.settings.publicListening || !playback.settings.enabled) return fail("Public listening disabled", 404);
  if (request.method !== "GET" && request.method !== "HEAD") return fail("Not found", 404);
  if (url.pathname === "/api/public/moq/listener") {
    try { return ok(await playback.listener(null), { headers: { "Cache-Control": "no-store" } }); }
    catch { return fail("Broadcast unavailable", 503); }
  }
  if (url.pathname === "/api/public/moq/status") {
    const s = playback.status;
    return ok({ instanceId: s.instanceId, revision: s.revision, generation: s.generation, trackId: null,
      position: s.position, duration: s.duration, state: s.state, params: DEFAULT_DSP_PARAMS,
      error: s.error ? "Broadcast unavailable" : null, nowPlaying: playback.nowPlaying() } satisfies ListenerPlaybackStatus,
      { headers: { "Cache-Control": "no-store" } });
  }
  if (url.pathname === "/moq" && server && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    // Only public subscribe credentials are forwarded. Client query strings,
    // cookies and authorization headers never reach the embedded relay.
    if (!playback.running) return fail("Broadcast unavailable", 503);
    const listener = await playback.listener(null);
    const target = new URL(`ws://${playback.settings.bind.includes(":") ? "[::1]" : "127.0.0.1"}:${playback.settings.port}/`);
    target.searchParams.set("jwt", new URL(listener.websocketUrl!).searchParams.get("jwt")!);
    const protocols = (request.headers.get("sec-websocket-protocol") || "").split(",").map(s => s.trim()).filter(Boolean);
    const upstream = new WebSocket(target, protocols);
    upstream.binaryType = "arraybuffer";
    const data: ProxyData = { upstream, pending: [], bytes: 0 };
    let downstream: ServerWebSocket<ProxyData> | undefined;
    upstream.onmessage = event => {
      const chunk = event.data as string | ArrayBuffer;
      if (downstream) { if (downstream.send(chunk) === 0) upstream.close(); }
      else {
        data.bytes += typeof chunk === "string" ? chunk.length : chunk.byteLength;
        if (data.bytes > 65536) upstream.close(1009, "Buffer exceeded");
        else data.pending.push(chunk);
      }
    };
    upstream.onclose = () => downstream?.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Relay timeout")), 5000);
        upstream.onopen = () => resolve(); upstream.onerror = () => reject(new Error("Relay unavailable"));
      });
      clearTimeout(timer);
      // open() runs after upgrade; use a closure to attach the actual socket.
      proxyAttach.set(data, socket => { downstream = socket; });
      if (server.upgrade(request, { data, headers: upstream.protocol ? { "Sec-WebSocket-Protocol": upstream.protocol } : {} })) return;
    } catch { /* return a generic error without private relay details */ }
    finally { clearTimeout(timer); }
    upstream.close(); return fail("Broadcast unavailable", 503);
  }
  if (url.pathname.startsWith("/api/") || !["/", "/public-listen"].includes(url.pathname) && !/^\/(assets|icons)\/[\w./-]+$/.test(url.pathname)) return fail("Not found", 404);
  if (url.pathname === "/") return Response.redirect(new URL("/public-listen", ctx.cfg.publicListener?.origin || url.origin), 302);
  return serveStatic({ request, ctx, url, params: {} });
}
const proxyAttach = new WeakMap<ProxyData, (socket: ServerWebSocket<ProxyData>) => void>();
export function startPublicListener(ctx: AppCtx) {
  const cfg = ctx.cfg.publicListener;
  if (!cfg) return;
  return Bun.serve<ProxyData>({ hostname: cfg.host, port: cfg.port,
    fetch: (request, server) => publicRequest(request, ctx, server),
    websocket: {
      maxPayloadLength: 1024 * 1024, backpressureLimit: 1024 * 1024, closeOnBackpressureLimit: true,
      open(socket) { proxyAttach.get(socket.data)?.(socket); proxyAttach.delete(socket.data); for (const chunk of socket.data.pending.splice(0)) socket.send(chunk); },
      message(socket, data) {
        if (socket.data.upstream.readyState !== WebSocket.OPEN || socket.data.upstream.bufferedAmount > 1024 * 1024) { socket.close(1013, "Relay busy"); return; }
        socket.data.upstream.send(data);
      },
      close(socket) { socket.data.upstream.close(); },
    },
  });
}
