// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// Helper invoked by the compile scripts: ensures the client SPA has been
// built and is reachable from the server's `serve-static` route at runtime
// (single-binary mode). For now, copies client/dist/spa into server/dist/spa
// so `bun build --compile` packs the static files into the binary as embedded
// resources (Bun's `--compile` embeds anything imported via `Bun.file()`).

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const CANDIDATES = [
  join(import.meta.dir, "..", "client", "dist", "pwa"),
  join(import.meta.dir, "..", "client", "dist", "spa"),
];
const SRC = CANDIDATES.find((p) => existsSync(p));
const DST = join(import.meta.dir, "..", "server", "dist", "spa");

if (!SRC) {
  console.error(`Missing client build. Run 'cd client && bun run build' first.`);
  process.exit(1);
}

function walk(dir: string, base: string): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = join(base, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, rel);
    } else {
      const target = join(DST, rel);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(full, target);
    }
  }
}

rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });
walk(SRC, "");
console.log(`Embedded client SPA from ${SRC} into ${DST}`);
