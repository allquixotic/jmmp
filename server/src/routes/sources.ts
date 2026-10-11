// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type {
  CreateSourceRequest,
  CreateSourceResponse,
  ListSourcesResponse,
  SourceConfig,
  SourceInstance,
  SourceKind,
  SourceSecrets,
  UpdateSourceRequest,
} from "@jmmp/shared";
import { del, fail, get, ok, patch, post, readJson, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import { decryptJson, encryptJson } from "../crypto.ts";
import { normalizeSpotifyUris } from "../sources/spotify.ts";

interface SourceRow {
  id: number;
  kind: SourceKind;
  name: string;
  config_json: string;
  creds_encrypted: Uint8Array | null;
  fetch_mode: "auto" | "direct" | "proxy";
  cache_policy: "all" | "pin-only" | "none";
  last_scanned_at: number | null;
  created_at: number;
}

function rowToInstance(row: SourceRow): SourceInstance {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: JSON.parse(row.config_json) as SourceConfig,
    fetchMode: row.fetch_mode,
    cachePolicy: row.cache_policy,
    lastScannedAt: row.last_scanned_at,
    createdAt: row.created_at,
  };
}

function defaultCachePolicy(kind: SourceKind): "all" | "pin-only" | "none" {
  switch (kind) {
    case "local":
      return "none";
    case "s3":
      return "all";
    case "qobuz":
    case "spotify":
      return "pin-only";
  }
}

export async function loadSecrets(
  req: Req,
  sourceId: number
): Promise<SourceSecrets | null> {
  const row = req.ctx.db
    .query<
      { creds_encrypted: Uint8Array | null; kind: SourceKind },
      [number]
    >("SELECT creds_encrypted, kind FROM sources WHERE id = ?")
    .get(sourceId);
  if (!row) return null;
  if (!row.creds_encrypted) return { kind: row.kind } as SourceSecrets;
  return decryptJson<SourceSecrets>(req.ctx.machineKey, row.creds_encrypted);
}

get("/api/sources", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const rows = req.ctx.db
    .query<SourceRow, []>("SELECT * FROM sources ORDER BY created_at")
    .all();
  const body: ListSourcesResponse = { sources: rows.map(rowToInstance) };
  return ok(body);
});

post("/api/sources", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<CreateSourceRequest>(req);
  if (!body.kind || !body.name || !body.config) {
    return fail("kind, name, config required", 400);
  }
  if (!["local", "s3", "qobuz"].includes(body.kind)) {
    return fail("invalid kind", 400);
  }

  const credsEncrypted = body.secrets
    ? await encryptJson(req.ctx.machineKey, body.secrets)
    : null;

  const result = req.ctx.db.run(
    `INSERT INTO sources (kind, name, config_json, creds_encrypted, fetch_mode, cache_policy)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      body.kind,
      body.name,
      JSON.stringify(body.config),
      credsEncrypted,
      body.fetchMode ?? "auto",
      body.cachePolicy ?? defaultCachePolicy(body.kind),
    ]
  );

  const row = req.ctx.db
    .query<SourceRow, [number]>("SELECT * FROM sources WHERE id = ?")
    .get(result.lastInsertRowid as number);
  if (!row) return fail("insert failed", 500);
  const resp: CreateSourceResponse = { source: rowToInstance(row) };
  return ok(resp, { status: 201 });
});

patch("/api/sources/:id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) return fail("bad id", 400);
  const body = await readJson<UpdateSourceRequest>(req);

  const existing = req.ctx.db
    .query<SourceRow, [number]>("SELECT * FROM sources WHERE id = ?")
    .get(id);
  if (!existing) return fail("not found", 404);
  if (existing.kind === "spotify") {
    if (body.secrets !== undefined) return fail("Reconnect Spotify through OAuth to change credentials");
    if (body.fetchMode !== undefined && body.fetchMode !== "proxy") return fail("Spotify audio is fetched by the server");
    if (body.config !== undefined) {
      const previous = JSON.parse(existing.config_json) as Extract<SourceConfig, { kind: "spotify" }>;
      if (body.config.kind !== "spotify" || body.config.clientId !== previous.clientId || body.config.redirectUri !== previous.redirectUri) return fail("Reconnect Spotify to change application settings");
      try { body.config = { ...previous, uris: Array.isArray(body.config.uris) && !body.config.uris.length ? [] : normalizeSpotifyUris(body.config.uris) }; }
      catch (error) { return fail(error instanceof Error ? error.message : "Invalid Spotify links"); }
    }
  }

  const updates: string[] = [];
  const values: SQLQueryBindings[] = [];
  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name);
  }
  if (body.config !== undefined) {
    updates.push("config_json = ?");
    values.push(JSON.stringify(body.config));
  }
  if (body.fetchMode !== undefined) {
    updates.push("fetch_mode = ?");
    values.push(body.fetchMode);
  }
  if (body.cachePolicy !== undefined) {
    updates.push("cache_policy = ?");
    values.push(body.cachePolicy);
  }
  if (body.secrets !== undefined) {
    updates.push("creds_encrypted = ?");
    values.push(await encryptJson(req.ctx.machineKey, body.secrets));
  }
  if (updates.length === 0) return ok({ source: rowToInstance(existing) });
  values.push(id);
  req.ctx.db.run(`UPDATE sources SET ${updates.join(", ")} WHERE id = ?`, values);

  const row = req.ctx.db
    .query<SourceRow, [number]>("SELECT * FROM sources WHERE id = ?")
    .get(id)!;
  return ok({ source: rowToInstance(row) });
});

del("/api/sources/:id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.id!, 10);
  if (!Number.isFinite(id)) return fail("bad id", 400);
  req.ctx.db.run("DELETE FROM sources WHERE id = ?", [id]);
  return ok({ deleted: id });
});
