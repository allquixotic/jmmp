// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from "node:fs";
import { loadConfig, resolveConfigPath, writeDefaultConfig } from "../config.ts";
import { detectTailscale } from "../tailscale.ts";
import { writeFileSync } from "node:fs";
import { withOrigin } from "../origins.ts";

export async function runInit(): Promise<void> {
  const path = resolveConfigPath();
  if (existsSync(path)) {
    console.log(`config already exists: ${path}`);
    return;
  }
  const cfg = writeDefaultConfig(path);
  console.log(`wrote default config: ${path}`);

  // If Tailscale is up, rewrite the config with the tailnet hostname baked
  // in so the user can see it before first launch.
  const ts = await detectTailscale();
  if (ts.available && ts.dnsName) {
    cfg.webauthn.rpId = ts.dnsName;
    cfg.webauthn.origin = withOrigin(
      cfg.webauthn.origin,
      `https://${ts.dnsName}:${cfg.listen.port}`
    );
    writeFileSync(path, Bun.YAML.stringify(cfg), { mode: 0o600 });
    console.log(`detected Tailscale: rewrote webauthn.rpId = ${ts.dnsName}`);
    console.log(`server will serve HTTPS on https://${ts.dnsName}:${cfg.listen.port}/`);
  } else {
    console.log(`no Tailscale detected — server will use http://localhost:${cfg.listen.port}/`);
    if (ts.reason) console.log(`  (${ts.reason})`);
  }

  // Touch the loaded config to validate it parses round-trip.
  void loadConfig(path);
}
