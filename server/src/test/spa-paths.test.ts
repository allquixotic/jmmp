// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { candidateSpaDirs } from "../spa-paths.ts";

describe("SPA asset path candidates", () => {
  test("source-mode server prefers the live client build over a stale server copy", () => {
    const here = "/repo/server/src/routes";
    const candidates = candidateSpaDirs(here);

    expect(candidates[0]).toBe(resolve("/repo/client/dist/pwa"));
    expect(candidates[1]).toBe(resolve("/repo/client/dist/spa"));
    expect(candidates.indexOf(resolve("/repo/server/dist/spa"))).toBeGreaterThan(1);
  });

  test("bundled server prefers the colocated SPA copy", () => {
    const here = "/repo/server/dist";
    const candidates = candidateSpaDirs(here);

    expect(candidates.indexOf(resolve("/repo/server/dist/spa"))).toBeLessThan(
      candidates.indexOf(resolve("/repo/client/dist/pwa"))
    );
  });
});
