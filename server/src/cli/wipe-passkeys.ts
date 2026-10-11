// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { ensureConfig } from "../config.ts";
import { initDb } from "../db.ts";
import { generateBootstrapToken, sha256 } from "../crypto.ts";

export async function runWipePasskeys(): Promise<void> {
  const { cfg } = ensureConfig();
  const db = initDb(cfg.dataDir);
  const tx = db.transaction(() => {
    db.run("DELETE FROM passkeys");
    db.run("DELETE FROM bootstrap_tokens");
    db.run("DELETE FROM webauthn_challenges");
    db.run("DELETE FROM session_devices");
    db.run("DELETE FROM passkey_invitations");
  });
  tx();
  const token = generateBootstrapToken();
  const hash = await sha256(token);
  db.run("INSERT INTO bootstrap_tokens (token_hash) VALUES (?)", [hash]);
  console.log(`
═══════════════════════════════════════════════════════════════
  Passkeys wiped. New bootstrap token (single use):

      ${token}

  Enter this in the jmmp web UI to register your first passkey.
═══════════════════════════════════════════════════════════════
`);
}
