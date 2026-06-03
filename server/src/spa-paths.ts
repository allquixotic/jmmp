// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { resolve } from "node:path";

export function candidateSpaDirs(here: string): string[] {
  return [
    // Source-mode server: server/src/routes/static.ts.
    resolve(here, "..", "..", "..", "client", "dist", "pwa"),
    resolve(here, "..", "..", "..", "client", "dist", "spa"),
    // Bundled server: server/dist/main.js with a colocated SPA copy.
    resolve(here, "spa"),
    // Bundled server fallback when running from repo checkout.
    resolve(here, "..", "..", "client", "dist", "pwa"),
    resolve(here, "..", "..", "client", "dist", "spa"),
    // Legacy copy used by older local builds.
    resolve(here, "..", "..", "dist", "spa"),
  ];
}
