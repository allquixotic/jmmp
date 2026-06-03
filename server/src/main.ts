#!/usr/bin/env bun
// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { ensureConfig } from "./config.ts";
import { initDb } from "./db.ts";
import { log, setLogLevel } from "./log.ts";
import { dispatch } from "./router.ts";
import { loadOrInitMachineKey } from "./crypto.ts";
import { printBootstrapTokenIfNeeded } from "./routes/auth.ts";
import { runInit } from "./cli/init.ts";
import { runWipePasskeys } from "./cli/wipe-passkeys.ts";
import { startScheduler } from "./scan/scheduler.ts";
import { detectTailscale, provisionCert } from "./tailscale.ts";
import { shouldBindLocalHttpCompanion, withOrigin } from "./origins.ts";

import "./routes/index.ts";

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (sub === "init") {
    await runInit();
    return;
  }
  if (sub === "wipe-passkeys") {
    await runWipePasskeys();
    return;
  }
  if (sub === "--help" || sub === "-h" || sub === "help") {
    printHelp();
    return;
  }

  const { cfg, path, created } = ensureConfig();
  setLogLevel(cfg.logLevel);
  if (created) {
    log.info(`wrote default config to ${path}`);
  }

  const db = initDb(cfg.dataDir);
  const machineKey = await loadOrInitMachineKey(cfg.dataDir);

  // ── Tailscale auto-upgrade ─────────────────────────────────────────────
  // If Tailscale is up + MagicDNS is enabled + HTTPS provisioning is on, we
  // serve over TLS with the tailnet hostname (a real registrable domain that
  // satisfies WebAuthn's rpId requirement) and a Let's Encrypt cert minted
  // by Tailscale. Otherwise we fall back to plain HTTP on localhost.
  let tlsConfig: { cert: ReturnType<typeof Bun.file>; key: ReturnType<typeof Bun.file> } | undefined;
  let scheme = "http";
  let hostname = cfg.listen.host;
  const configuredHost = cfg.listen.host;

  if (cfg.tailscaleAuto) {
    const ts = await detectTailscale();
    if (ts.available && ts.dnsName) {
      log.info(`tailscale detected: ${ts.dnsName}`);
      try {
        const certs = await provisionCert(ts, cfg.dataDir);
        log.info(`tailscale cert ready (${certs.certPath})`);
        tlsConfig = {
          cert: Bun.file(certs.certPath),
          key: Bun.file(certs.keyPath),
        };
        cfg.webauthn.rpId = ts.dnsName;
        cfg.webauthn.origin = withOrigin(
          cfg.webauthn.origin,
          `https://${ts.dnsName}:${cfg.listen.port}`
        );
        // Bind to the Tailscale interface specifically so the service is
        // only reachable over the tailnet (and from the host itself).
        hostname = ts.tailscaleIp ?? "0.0.0.0";
        scheme = "https";
      } catch (err) {
        log.warn(
          `tailscale cert provisioning failed; falling back to plain HTTP. ` +
            (err instanceof Error ? err.message : String(err))
        );
      }
    } else if (ts.reason) {
      log.debug(`tailscale not used: ${ts.reason}`);
    }
  }

  await printBootstrapTokenIfNeeded(db);

  const ctx = { cfg, db, machineKey };
  startScheduler(ctx);

  const server = Bun.serve({
    hostname,
    port: cfg.listen.port,
    ...(tlsConfig ? { tls: tlsConfig } : {}),
    fetch(request) {
      return dispatch(request, ctx);
    },
    error(err) {
      log.error(`fetch error: ${err.message}`);
      return new Response("internal error", { status: 500 });
    },
  });

  const publicHost =
    scheme === "https" && cfg.webauthn.rpId !== "localhost"
      ? cfg.webauthn.rpId
      : server.hostname;
  log.info(`jmmp listening on ${scheme}://${publicHost}:${server.port}`);
  if (shouldBindLocalHttpCompanion(scheme as "http" | "https", configuredHost, hostname)) {
    const localServer = Bun.serve({
      hostname: configuredHost,
      port: cfg.listen.port,
      fetch(request) {
        return dispatch(request, ctx);
      },
      error(err) {
        log.error(`local fetch error: ${err.message}`);
        return new Response("internal error", { status: 500 });
      },
    });
    log.info(`jmmp also listening on http://localhost:${localServer.port} for local dev`);
  }
  if (scheme === "http") {
    log.info(
      `(tip) WebAuthn requires localhost or HTTPS. Open http://localhost:${server.port}/ — NOT a raw IP.`
    );
  }
}

function printHelp() {
  console.log(`jmmp — Just My Music Player

Usage:
  jmmp                 Run the server.
  jmmp init            Write a default config file (random jwt_secret).
  jmmp wipe-passkeys   Delete all passkeys and emit a fresh bootstrap token.

Environment:
  JMMP_CONFIG=<path>   Override the default config path.

Tailscale:
  If Tailscale is running on this machine and HTTPS provisioning is enabled
  on your tailnet, jmmp auto-upgrades to HTTPS using the MagicDNS hostname
  and a Let's Encrypt cert obtained via \`tailscale cert\`. To disable, set
  tailscaleAuto: false in the config file.
`);
}

try {
  await main();
} catch (err) {
  console.error("fatal:", err);
  process.exit(1);
}
