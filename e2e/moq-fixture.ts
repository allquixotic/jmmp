// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
// Runs the built application against an isolated database, never user data.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initDb } from "../server/src/db.ts";
import { loadOrInitMachineKey } from "../server/src/crypto.ts";
import { mintSession } from "../server/src/session.ts";
import type { AppCtx } from "../server/src/router.ts";
import { setLogLevel } from "../server/src/log.ts";
setLogLevel("error");
const root = resolve(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "jmmp-moq-browser-"));
function freePort() {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port!; probe.stop(true); return port;
}
const port = freePort(), relayPort = freePort();
const url = "http://localhost:" + port;
const cfg = { listen: { host: "127.0.0.1", port }, tailscaleAuto: false, dataDir: dir,
  jwtSecret: crypto.randomUUID(), sessionTtlDays: 1, logLevel: "error" as const,
  webauthn: { rpId: "localhost", rpName: "jmmp test", origin: url } };
const db = initDb(dir), machineKey = await loadOrInitMachineKey(dir);
const { token } = await mintSession({ cfg, db, machineKey } as AppCtx, "browser-owner", "full");
db.run("UPDATE session_devices SET is_player = 1 WHERE id = 'browser-owner'");
db.run("INSERT INTO sources (kind, name, config_json, cache_policy) VALUES ('local', 'Uploaded music', '{}', 'all')");
db.close();
const config = join(dir, "jmmp.yml"); await Bun.write(config, Bun.YAML.stringify(cfg));
const executable = process.env.JMMP_E2E_EXECUTABLE;
function launch() { return Bun.spawn(executable ? [resolve(executable)] : [process.execPath, join(root, "server/dist/main.js")],
  { cwd: executable ? dir : root, env: { ...process.env, JMMP_CONFIG: config,
    PATH: executable ? "/usr/bin:/bin" : process.env.PATH }, stdout: "ignore", stderr: "inherit" }); }
let child = launch();
async function stop() { child.kill(); await child.exited; rmSync(dir, { recursive: true, force: true }); process.exit(0); }
process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
async function ready() { for (let attempt = 0; ; attempt++) {
  try { if ((await fetch(url + "/api/auth/status")).ok) break; } catch {}
  if (attempt > 100 || child.exitCode !== null) throw new Error("Built jmmp did not start");
  await Bun.sleep(100);
} }
await ready();
console.log(JSON.stringify({ url, token, relayPort }));
let pending = "";
for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk);
  let end: number;
  while ((end = pending.indexOf("\n")) >= 0) {
    const command = pending.slice(0, end); pending = pending.slice(end + 1);
    if (command === "restart") { child.kill(); await child.exited; child = launch(); await ready(); }
  }
}
await stop();
