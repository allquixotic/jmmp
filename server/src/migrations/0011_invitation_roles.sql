-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0
ALTER TABLE passkey_invitations ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('viewer', 'player', 'dj', 'admin'));
