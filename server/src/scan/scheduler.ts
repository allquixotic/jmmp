// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { AppCtx } from "../router.ts";
import { log } from "../log.ts";
import { runScan } from "./worker.ts";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const TICK_MS = 60_000; // every minute, check sources & rescan stale ones

export function startScheduler(ctx: AppCtx): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => void tick(ctx), TICK_MS);
  // Initial sweep — short delay to let other startup work finish.
  setTimeout(() => void tick(ctx), 5_000);
}

async function tick(ctx: AppCtx): Promise<void> {
  const sources = ctx.db
    .query<
      { id: number; kind: string; last_scanned_at: number | null },
      []
    >("SELECT id, kind, last_scanned_at FROM sources WHERE kind != 'local'")
    .all();
  const now = Math.floor(Date.now() / 1000);
  for (const s of sources) {
    if (s.kind === "qobuz") continue; // never bulk-scan
    const idleSec = s.last_scanned_at ? now - s.last_scanned_at : Infinity;
    // Aggressive: rescan if last >= 5 minutes ago
    if (idleSec >= 300) {
      log.info(`scheduling scan source=${s.id}`);
      void runScan(ctx.db, ctx.machineKey, s.id, { extractMetadata: true });
    }
  }
}
