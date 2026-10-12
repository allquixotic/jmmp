// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { can, canControlPlayback, type Permission } from "@jmmp/shared";
import { fail, type Req } from "./router.ts";
import { requireFullSession } from "./session.ts";
import { playbackController } from "./audio/controller.ts";

const publicRoutes = new Set([
  "GET /api/auth/status", "GET /api/auth/_debug/bootstrap-token",
  "POST /api/auth/bootstrap-redeem", "GET /api/auth/passkey/auth/options",
  "POST /api/auth/passkey/auth/verify", "POST /api/auth/logout",
  "GET /api/auth/passkey/register/options", "POST /api/auth/passkey/register/verify",
  "POST /api/auth/passkey/invitation/info", "POST /api/auth/passkey/invitation/options",
  "POST /api/auth/passkey/invitation/verify",
]);
const observations = new Set([
  "/api/me", "/api/settings", "/api/sources", "/api/queue", "/api/history",
  "/api/catalog/artists", "/api/catalog/albums", "/api/catalog/tracks",
  "/api/catalog/search", "/api/catalog/files", "/api/art/:hash",
  "/api/playlists", "/api/playlists/:id", "/api/playback",
  "/api/playback/output", "/api/moq/listener",
]);

/** Unclassified API routes require admin; new handlers never silently grant access. */
export function routePermission(method: string, path: string): Permission | null {
  if (!path.startsWith("/api/")) return null;
  if (publicRoutes.has(method + " " + path)) return null;
  if (method === "GET" && observations.has(path)) return "observe";
  if (path === "/api/stream/:track_id") return "localPlayback";
  if (path === "/api/heartbeat") return "control";
  if (path === "/api/take-control" || path === "/api/playback" || path === "/api/queue" ||
      path === "/api/queue/append" || path === "/api/settings" || path === "/api/history") return "control";
  if (path.startsWith("/api/playlists")) return "playlistWrite";
  if ((method === "POST" && path === "/api/sources") || path === "/api/sources/:id/upload" ||
      path === "/api/catalog/upload" || path.startsWith("/api/scan/") ||
      (path.startsWith("/api/sources/") && path.includes("/oauth/")) ||
      path === "/api/sources/qobuz/login") return "sourceAdd";
  return "admin";
}

export async function authorizeRoute(req: Req, pattern: string): Promise<Response | null> {
  const permission = routePermission(req.request.method, pattern);
  if (!permission) return null;
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  if (!can(session.role, permission)) return fail("Your passkey role cannot perform this action", 403, "role");
  if (permission === "control" && pattern !== "/api/heartbeat") {
    if (!canControlPlayback(session.role, playbackController(req.ctx).settings.enabled)) {
      return fail("Players require MoQ playback; local playback requires DJ or admin", 403, "playback_mode");
    }
    if (pattern !== "/api/take-control" && !req.ctx.db.query("SELECT 1 FROM session_devices WHERE id=? AND is_player=1").get(session.did)) {
      return fail("Only the current playback controller can change playback", 409, "player_conflict");
    }
  }
  return null;
}
