-- Copyright 2026 Sean McNamara
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE playlists
ADD COLUMN local_order INTEGER NOT NULL DEFAULT 0;
