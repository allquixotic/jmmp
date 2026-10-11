// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { chmod, mkdir, rename } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { helperBase64, workerSource } from "./assets.ts";
export async function audioAssets(dataDir: string): Promise<{ helper: string; worker: string }> {
  if (helperBase64 && workerSource) {
    const hash = createHash("sha256").update(helperBase64).update(workerSource).digest("hex").slice(0, 16);
    const dir = join(dataDir, "native", hash); await mkdir(dir, { recursive: true, mode: 0o700 });
    const helper = join(dir, "jmmp-moq"), worker = join(dir, "audio-worker.js");
    for (const [path, data] of [[helper, Buffer.from(helperBase64, "base64")], [worker, workerSource]] as const) {
      if (!(await Bun.file(path).exists())) {
        const tmp = `${path}.${crypto.randomUUID()}.tmp`; await Bun.write(tmp, data); await chmod(tmp, 0o700); await rename(tmp, path);
      }
    }
    return { helper, worker };
  }
  let root = resolve(import.meta.dir);
  while (!(await Bun.file(join(root, "native/Cargo.toml")).exists())) {
    const parent = dirname(root); if (parent === root) throw new Error("jmmp audio assets missing; rebuild jmmp with bun run build"); root = parent;
  }
  const helper = join(root, "native/target/debug/jmmp-moq");
  // Source checkout startup builds automatically when output is first enabled.
  const build = Bun.spawn(["cargo", "build", "--locked", "--quiet", "--manifest-path", join(root, "native/Cargo.toml")], { stdout: "inherit", stderr: "inherit" });
  if (await build.exited) throw new Error("Could not build jmmp-moq; install Rust >= 1.96");
  return { helper, worker: join(root, "server/src/audio/worker.ts") };
}
