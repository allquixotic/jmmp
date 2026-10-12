// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { AppCtx } from "../router.ts";
import { mintSession } from "../session.ts";
import type { SessionScope } from "../jwt.ts";
export async function mintTestSession(ctx: AppCtx, did: string, scope: SessionScope) {
  let passkeyId: number | undefined;
  if (scope === "full") {
    const credential = Buffer.from("test-session:" + did);
    ctx.db.run("INSERT OR IGNORE INTO passkeys(credential_id,public_key,nickname) VALUES (?,?,'__test__')", [credential, new Uint8Array([1])]);
    passkeyId = ctx.db.query<{ id: number }, [Uint8Array]>("SELECT id FROM passkeys WHERE credential_id=?").get(credential)!.id;
  }
  return { ...await mintSession(ctx, did, scope, passkeyId), passkeyId };
}
