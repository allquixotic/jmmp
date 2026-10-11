// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { PlaybackCommand } from "@jmmp/shared";
import { get, post, put, ok, fail } from "../router.ts";
import { requireFullSession } from "../session.ts";
import { playbackController } from "../audio/controller.ts";

get("/api/moq", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  return ok(playbackController(req.ctx).snapshot());
});
put("/api/moq", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  try { return ok(await playbackController(req.ctx).configure(await req.request.json())); }
  catch (error) { return fail(String(error), 400); }
});
post("/api/moq/test", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  try { return ok(await playbackController(req.ctx).test(await req.request.json(), session)); }
  catch (error) { return fail(String(error), 400); }
});
post("/api/moq/test/end", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  await playbackController(req.ctx).endTest(); return ok({});
});
get("/api/moq/listener", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  try { return ok(await playbackController(req.ctx).listener(session)); }
  catch (error) { return fail(String(error), 409); }
});
get("/api/playback", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  return ok(playbackController(req.ctx).status);
});
post("/api/playback", async req => {
  const session = await requireFullSession(req); if (session instanceof Response) return session;
  try {
    const body = await req.request.json() as { command: PlaybackCommand; revision?: number };
    return ok(await playbackController(req.ctx).command(body.command, session, body.revision));
  } catch (error) { return fail(String(error), 409); }
});
