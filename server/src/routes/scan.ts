// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { fail, get, ok, post, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";
import { getScanProgress, runScan } from "../scan/worker.ts";

post("/api/scan/:source_id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.source_id!, 10);
  if (!Number.isFinite(id)) return fail("bad source id", 400);
  void runScan(req.ctx.db, req.ctx.machineKey, id, { extractMetadata: true });
  return ok({ accepted: id });
});

get("/api/scan/:source_id", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const id = parseInt(req.params.source_id!, 10);
  if (!Number.isFinite(id)) return fail("bad source id", 400);
  const p = getScanProgress(id);
  return ok({ progress: p ?? null });
});
