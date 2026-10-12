// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type {
  QobuzLoginRequest,
  QobuzOAuthStartRequest,
  QobuzOAuthStartResponse,
  QobuzOAuthStatusResponse,
} from "@jmmp/shared";
import { randomUUID } from "node:crypto";
import { fail, get, ok, post, readJson, type Req } from "../router.ts";
import { encryptJson } from "../crypto.ts";
import { requireFullSession } from "../session.ts";
import { configuredRequestOrigin } from "../origins.ts";
import {
  exchangeOAuthCode,
  harvestAppCreds,
  login,
  oauthCodeFromParams,
  oauthSignInUrl,
  QOBUZ_OAUTH_PRIVATE_KEY,
  QobuzHttpError,
  type HarvestedAppCreds,
  type QobuzLoginResult,
} from "../sources/qobuz.ts";

const OAUTH_TTL_MS = 10 * 60 * 1000;

type PendingQobuzOAuth = {
  deviceId: string;
  sourceName: string;
  creds: HarvestedAppCreds;
  createdAt: number;
  status: "pending" | "complete" | "error";
  sourceId?: number;
  email?: string;
  error?: string;
};

const pendingOAuth = new Map<string, PendingQobuzOAuth>();

post("/api/sources/qobuz/oauth/start", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<QobuzOAuthStartRequest>(req);
  const sourceName = body.sourceName?.trim() || "Qobuz";
  try {
    cleanupPendingOAuth();
    const creds = await harvestAppCreds();
    const state = randomUUID();
    const redirectUrl = `${configuredRequestOrigin(req.request, req.ctx.cfg.webauthn.origin).origin}/api/sources/qobuz/oauth/callback/${state}`;
    pendingOAuth.set(state, {
      deviceId: session.did, sourceName,
      creds,
      createdAt: Date.now(),
      status: "pending",
    });
    const resp: QobuzOAuthStartResponse = {
      state,
      authUrl: oauthSignInUrl(creds.appId, redirectUrl),
    };
    return ok(resp);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 502, "qobuz_oauth_start_failed");
  }
});

get("/api/sources/qobuz/oauth/status/:state", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  cleanupPendingOAuth();
  const pending = pendingOAuth.get(req.params.state!);
  if (!pending || pending.deviceId !== session.did) return fail("Qobuz sign-in expired", 404, "qobuz_oauth_expired");
  const body: QobuzOAuthStatusResponse =
    pending.status === "complete"
      ? { status: "complete", sourceId: pending.sourceId!, email: pending.email! }
      : pending.status === "error"
        ? { status: "error", error: pending.error ?? "Qobuz sign-in failed" }
        : { status: "pending" };
  return ok(body);
});

get("/api/sources/qobuz/oauth/callback/:state", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) {
    return oauthResultPage(
      "error",
      "jmmp session is not active. Return to jmmp and start Qobuz sign-in again.",
      401
    );
  }
  cleanupPendingOAuth();
  const state = req.params.state!;
  const pending = pendingOAuth.get(state);
  if (!pending || pending.deviceId !== session.did) {
    return oauthResultPage("error", "Qobuz sign-in expired. Return to jmmp and try again.", 400);
  }
  if (pending.status === "complete") {
    return oauthResultPage("success", `Qobuz connected as ${pending.email}.`, 200);
  }
  if (pending.status === "error") {
    return oauthResultPage("error", pending.error ?? "Qobuz sign-in failed.", 502);
  }

  const code = oauthCodeFromParams(req.url.searchParams);
  if (!code) {
    pending.status = "error";
    pending.error = "Qobuz did not return an OAuth code.";
    return oauthResultPage("error", pending.error, 400);
  }

  try {
    const result = await exchangeOAuthCode(
      code,
      req.url.searchParams.get("private_key") ||
        pending.creds.oauthPrivateKey ||
        QOBUZ_OAUTH_PRIVATE_KEY,
      pending.creds
    );
    const sourceId = await insertQobuzSource(req, pending.sourceName, result);
    pending.status = "complete";
    pending.sourceId = sourceId;
    pending.email = result.email;
    return oauthResultPage("success", `Qobuz connected as ${result.email}.`, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pending.status = "error";
    pending.error = message;
    return oauthResultPage("error", message, 502);
  }
});

post("/api/sources/qobuz/login", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<QobuzLoginRequest>(req);
  if (!body.email || !body.password || !body.sourceName) {
    return fail("sourceName, email, password required", 400);
  }
  try {
    const result = await login(body.email, body.password);
    const sourceId = await insertQobuzSource(req, body.sourceName, result);
    return ok(
      { sourceId, email: result.email },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof QobuzHttpError && err.status === 401) {
      return fail(message, 401, "qobuz_auth_failed");
    }
    return fail(message, 502, "qobuz_login_failed");
  }
});

post("/api/sources/qobuz/reharvest", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  try {
    const creds = await harvestAppCreds();
    return ok({ appId: creds.appId });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 502, "harvest_failed");
  }
});

async function insertQobuzSource(
  req: Req,
  sourceName: string,
  result: QobuzLoginResult
): Promise<number> {
  const config = { kind: "qobuz", userId: result.userId, email: result.email };
  const secrets = {
    kind: "qobuz",
    userAuthToken: result.userAuthToken,
    appId: result.appId,
    appSecret: result.appSecret,
    harvestedAt: Math.floor(Date.now() / 1000),
  };
  const credsEncrypted = await encryptJson(req.ctx.machineKey, secrets);
  const insert = req.ctx.db.run(
    `INSERT INTO sources (kind, name, config_json, creds_encrypted, fetch_mode, cache_policy)
     VALUES ('qobuz', ?, ?, ?, 'proxy', 'pin-only')`,
    [sourceName, JSON.stringify(config), credsEncrypted]
  );
  return insert.lastInsertRowid as number;
}

function cleanupPendingOAuth(now = Date.now()): void {
  for (const [state, pending] of pendingOAuth.entries()) {
    if (now - pending.createdAt > OAUTH_TTL_MS) pendingOAuth.delete(state);
  }
}

function oauthResultPage(kind: "success" | "error", message: string, status: number): Response {
  const title = kind === "success" ? "Qobuz Connected" : "Qobuz Sign-in Failed";
  const type = kind === "success" ? "jmmp:qobuz-connected" : "jmmp:qobuz-error";
  const payload = JSON.stringify({ type, message }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 3rem; line-height: 1.5; color: #1f2937; }
      .status { max-width: 34rem; }
      h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
      p { margin: 0; }
    </style>
  </head>
  <body>
    <main class="status">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
    <script>
      const payload = ${payload};
      if (window.opener) window.opener.postMessage(payload, window.location.origin);
      if (payload.type === "jmmp:qobuz-connected") setTimeout(() => window.close(), 700);
    </script>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
