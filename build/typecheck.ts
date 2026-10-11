// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const checks = [
  ["client", ["bunx", "quasar", "prepare", "--silent"]],
  [".", ["bunx", "tsc", "--noEmit", "-p", "shared/tsconfig.json"]],
  [".", ["bunx", "tsc", "--noEmit", "-p", "server/tsconfig.json"]],
  ["client", ["bunx", "vue-tsc", "--noEmit", "-p", "tsconfig.json"]],
  ["client", ["bunx", "vue-tsc", "--noEmit", "-p", "tsconfig.test.json"]],
  ["client", ["bunx", "tsc6", "--noEmit", "-p", "src-pwa/tsconfig.json"]],
  [".", ["bunx", "tsc", "--noEmit", "-p", "tsconfig.tools.json"]],
] as const;

let failed = false;
for (const [directory, cmd] of checks) {
  console.log(`Typecheck: ${directory} ${cmd.join(" ")}`);
  const child = Bun.spawn([...cmd], {
    cwd: resolve(root, directory),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code) failed = true;
}
if (failed) process.exit(1);
