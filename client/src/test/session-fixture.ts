// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_USER_SETTINGS, type PasskeyRole } from "@jmmp/shared";
import { useSessionStore } from "../stores/session";
export function authorizeTestSession(role: PasskeyRole = "admin", moqEnabled = false) {
  const session = useSessionStore();
  session.hasFullSession = true;
  session.me = { deviceId: "test", passkeyId: 1, role, moqEnabled, streamUrl: moqEnabled ? "/listen" : null,
    isPlayer: role !== "viewer", playerConflict: null, settings: structuredClone(DEFAULT_USER_SETTINGS) };
  return session;
}
