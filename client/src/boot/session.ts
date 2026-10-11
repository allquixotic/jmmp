// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineBoot } from "#q-app";
import { useSessionStore } from "src/stores/session";

export default defineBoot(async ({ store }) => {
  if (location.pathname === "/public-listen") return;
  const session = useSessionStore(store);
  try {
    await session.refreshStatus();
  } catch (err) {
    console.warn("auth status fetch failed", err);
  }
  if (session.hasFullSession) {
    session.startPlayerLock();
  }
});
