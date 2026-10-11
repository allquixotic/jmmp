// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { X509Certificate } from "node:crypto";
import type { MoqSettings } from "@jmmp/shared";
import { audioAssets } from "./runtime.ts";
import { GapWatch, readHelperEvents, type PipelineDiagnostic } from "./diagnostics.ts";
export function redactMoqDiagnostics(value: string): string {
  return value.replace(/(?:https?|wss?):\/\/[^\s]+/g, "[relay URL]").replace(/eyJ[A-Za-z0-9_.-]+/g, "[credential]");
}
export class NativeOutput {
  readonly name = `jmmp-${crypto.randomUUID()}.hang`;
  private child?: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  private writing = Promise.resolve();
  fingerprint?: string;
  workerPath = "";
  alive = false;
  bind = "";
  onFailure: (error: string) => void = () => {};
  onDiagnostic: (event: PipelineDiagnostic) => void = () => {};
  async start(settings: MoqSettings, dataDir: string, authUrl: string, upstream?: { url: string; protocol: string }): Promise<void> {
    this.bind = settings.bind;
    const assets = await audioAssets(dataDir); this.workerPath = assets.worker;
    const address = `${settings.bind.includes(":") ? `[${settings.bind}]` : settings.bind}:${settings.port}`;
    const secure = new URL(settings.publicUrl).protocol === "https:" && !settings.tlsOffload;
    const tls = settings.certPath ? { cert: [settings.certPath], key: [settings.keyPath] } : { generate: ["localhost", "127.0.0.1", "::1"] };
    const relay = { listen: { bind: address, tls }, web: secure
      ? { https: { listen: address, cert: [settings.certPath], key: [settings.keyPath] } }
      : { http: { listen: address } }, auth: { url: authUrl }, cache: { duration: "10s" }, drain_timeout: "1s" };
    const child = this.child = Bun.spawn([assets.helper], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    let stderr = "";
    void (async () => { for await (const bytes of child.stderr) stderr = (stderr + new TextDecoder().decode(bytes)).slice(-4000); })();
    // Relay credentials can live in URL paths; never return diagnostics containing them.
    const safeError = () => redactMoqDiagnostics(stderr);
    child.stdin.write(JSON.stringify({ relay, bitrate: settings.bitrate, name: this.name, upstream }) + "\n"); await child.stdin.flush();
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      let resolveReady!: () => void, rejectReady!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      // Keep draining the same reader after ready, including subsequent lines
      // in that chunk. A full stdout pipe must never stall audio publication.
      void readHelperEvents(child.stdout, resolveReady, event => this.onDiagnostic(event))
        .then(() => rejectReady(new Error(`MoQ helper exited: ${safeError()}`)))
        .catch(() => rejectReady(new Error("MoQ helper diagnostic stream failed")));
      await Promise.race([
        ready,
        new Promise<never>((_, reject) => { startupTimer = setTimeout(() => reject(new Error("MoQ helper startup timed out")), 30000);  }),
      ]);
      clearTimeout(startupTimer); this.alive = true;
      if (settings.certPath) this.fingerprint = new X509Certificate(await Bun.file(settings.certPath).text()).fingerprint256.replaceAll(":", "").toLowerCase();
      else {
        const host = settings.bind === "0.0.0.0" ? "127.0.0.1" : settings.bind === "::" ? "[::1]" : settings.bind.includes(":") ? `[${settings.bind}]` : settings.bind;
        this.fingerprint = (await (await fetch(`http://${host}:${settings.port}/certificate.sha256`, { signal: AbortSignal.timeout(5000) })).text()).trim();
      }
      void child.exited.then(code => { if (this.alive) { this.alive = false; this.onFailure(`MoQ helper exited (${code}): ${safeError()}`); } });
    } catch (error) { clearTimeout(startupTimer); await this.close(); throw error; }
  }
  write(kind: number, generation: number, pcm?: Float32Array): Promise<void> {
    let phase = "pipe_queue";
    const watch = new GapWatch(event => this.onDiagnostic(event), () => ({ stage: "server_helper", phase, generation, bytes: pcm?.byteLength ?? 0 }), 100, 0);
    if (kind === 0) watch.progress(performance.now());
    const monitoring = kind === 0 ? setInterval(() => watch.tick(performance.now()), 50) : undefined;
    const operation = this.writing.then(async () => {
      phase = "pipe_flush";
      const child = this.child; if (!child || !this.alive) throw new Error("MoQ relay is unavailable");
      const header = new Uint8Array(24), view = new DataView(header.buffer);
      view.setUint32(0, kind, true); view.setUint32(4, generation, true); view.setUint32(8, pcm?.byteLength ?? 0, true);
      child.stdin.write(header); if (pcm) child.stdin.write(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      await child.stdin.flush();
      watch.progress(performance.now());
    }).finally(() => { clearInterval(monitoring); watch.reset(); });
    this.writing = operation.catch(() => {}); return operation;
  }
  async close(): Promise<void> {
    await this.writing;
    this.alive = false; const child = this.child; this.child = undefined;
    if (child) {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2500);
      try { await child.exited; } finally { clearTimeout(timer); }
    }
  }
}
