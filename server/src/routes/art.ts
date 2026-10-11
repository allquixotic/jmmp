// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { fail, get, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";
import { getArtBlob } from "../art-store.ts";

get("/api/art/:hash", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const hash = req.params.hash;
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return fail("bad art hash", 400);
  const row = getArtBlob(req.ctx.db, hash.toLowerCase());
  if (!row) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
