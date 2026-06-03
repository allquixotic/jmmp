// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { MeResponse } from "@jmmp/shared";
import {
  clampPitchHudState,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
} from "@jmmp/shared";
import { fail, get, ok, post, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";

get("/api/me", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const row = req.ctx.db
    .query<
      { is_player: number; last_heartbeat_at: number },
      [string]
    >(
      "SELECT is_player, last_heartbeat_at FROM session_devices WHERE id = ?"
    )
    .get(session.did);

  const otherPlayer = req.ctx.db
    .query<
      { id: string; last_heartbeat_at: number },
      [string]
    >(
      `SELECT id, last_heartbeat_at FROM session_devices
       WHERE is_player = 1 AND id != ? AND last_heartbeat_at > unixepoch() - 60`
    )
    .get(session.did);

  const settings = loadSettings(req);

  const body: MeResponse = {
    deviceId: session.did,
    isPlayer: row?.is_player === 1,
    settings,
    playerConflict: otherPlayer
      ? { otherDeviceId: otherPlayer.id, lastHeartbeatAt: otherPlayer.last_heartbeat_at }
      : null,
  };
  return ok(body);
});

post("/api/heartbeat", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  req.ctx.db.run(
    "UPDATE session_devices SET last_heartbeat_at = unixepoch() WHERE id = ?",
    [session.did]
  );
  return ok({});
});

post("/api/take-control", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  req.ctx.db.run("UPDATE session_devices SET is_player = 0");
  req.ctx.db.run(
    "UPDATE session_devices SET is_player = 1, last_heartbeat_at = unixepoch() WHERE id = ?",
    [session.did]
  );
  return ok({ isPlayer: true });
});

import { put, readJson } from "../router.ts";

get("/api/settings", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  return ok({ settings: loadSettings(req) });
});

put("/api/settings", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<{ settings?: Partial<UserSettings> }>(req);
  if (!body.settings) return fail("settings required", 400);
  const current = loadSettings(req);
  const next = normalizeSettings({ ...current, ...body.settings });
  req.ctx.db.run(
    `INSERT INTO settings (key, value_json) VALUES ('user', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = unixepoch()`,
    [JSON.stringify(next)]
  );
  return ok({ settings: next });
});

function loadSettings(req: Req): UserSettings {
  const row = req.ctx.db
    .query<{ value_json: string }, []>(
      "SELECT value_json FROM settings WHERE key = 'user'"
    )
    .get();
  if (!row) return DEFAULT_USER_SETTINGS;
  try {
    const parsed = JSON.parse(row.value_json) as Partial<UserSettings>;
    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

function normalizeSettings(settings: Partial<UserSettings>): UserSettings {
  const merged = { ...DEFAULT_USER_SETTINGS, ...settings };
  return {
    ...merged,
    pitchHud: clampPitchHudState({
      ...DEFAULT_USER_SETTINGS.pitchHud,
      ...(settings.pitchHud ?? merged.pitchHud),
    }),
  };
}
