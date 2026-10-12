-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0
ALTER TABLE passkeys ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('viewer', 'player', 'dj', 'admin'));
ALTER TABLE session_devices ADD COLUMN passkey_id INTEGER REFERENCES passkeys(id) ON DELETE CASCADE;
CREATE INDEX idx_session_passkey ON session_devices(passkey_id);
-- Older sessions cannot identify their authenticating credential. Require sign-in
-- again rather than assigning an unrelated passkey's permissions to them.
UPDATE session_devices SET is_player=0;
