// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const serverOnly = process.argv.includes("--server-only");
try {
  const commands = [["bun", "build/native.ts"],
    ...(serverOnly ? [] : [["bun", "--cwd=client", "run", "build"], ["bun", "build/embed-client.ts"]]),
    ["bun", "build", "--target=bun", "--outdir=server/dist", "server/src/main.ts"]];
  for (const args of commands) {
    const child = Bun.spawn(args, { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (await child.exited) throw new Error(`Build failed: ${args.join(" ")}`);
  }
} finally { await import("./reset-native.ts"); }
