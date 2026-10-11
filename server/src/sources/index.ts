// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Database } from "bun:sqlite";
import type { SourceConfig, SourceKind, SourceSecrets } from "@jmmp/shared";
import { decryptJson } from "../crypto.ts";
import { makeLocalAdapter } from "./local.ts";
import { makeS3Adapter } from "./s3.ts";
import { makeQobuzAdapter } from "./qobuz.ts";
import { makeSpotifyAdapter } from "./spotify.ts";
import type { ServerSourceAdapter } from "./types.ts";

export async function loadAdapter(
  db: Database,
  machineKey: CryptoKey,
  sourceId: number,
  dataDir?: string
): Promise<{ adapter: ServerSourceAdapter; kind: SourceKind } | null> {
  const row = db
    .query<
      {
        kind: SourceKind;
        config_json: string;
        creds_encrypted: Uint8Array | null;
      },
      [number]
    >("SELECT kind, config_json, creds_encrypted FROM sources WHERE id = ?")
    .get(sourceId);
  if (!row) return null;
  const config = JSON.parse(row.config_json) as SourceConfig;
  let secrets: SourceSecrets;
  if (row.creds_encrypted) {
    secrets = await decryptJson<SourceSecrets>(machineKey, row.creds_encrypted);
  } else {
    secrets = { kind: row.kind } as SourceSecrets;
  }
  if (row.kind === "s3") return { adapter: makeS3Adapter(config, secrets), kind: "s3" };
  if (row.kind === "qobuz")
    return { adapter: makeQobuzAdapter(config, secrets, sourceId), kind: "qobuz" };
  if (row.kind === "spotify" && config.kind === "spotify")
    return { adapter: makeSpotifyAdapter(db, machineKey, sourceId, config, dataDir), kind: "spotify" };
  if (row.kind === "local" && dataDir) return { adapter: makeLocalAdapter(db, dataDir, sourceId), kind: "local" };
  return null;
}
