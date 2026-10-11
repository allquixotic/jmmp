-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0
CREATE TABLE passkey_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash BLOB NOT NULL UNIQUE CHECK(length(token_hash) = 32),
  label TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE passkey_invitation_challenges (
  challenge TEXT PRIMARY KEY,
  invitation_id INTEGER NOT NULL REFERENCES passkey_invitations(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_passkey_invitation_challenges_invite ON passkey_invitation_challenges(invitation_id);
