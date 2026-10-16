// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { log } from "../log.ts";

export type PipelineStage = "source_server" | "server_helper" | "helper_upstream";
export interface PipelineContext {
  stage: PipelineStage;
  phase?: string;
  generation?: number;
  trackId?: number;
  sourceId?: number;
  [metric: string]: string | number | boolean | undefined;
}
export interface PipelineDiagnostic extends PipelineContext { event: string; }
export function logPipeline(event: PipelineDiagnostic) {
  const level = ["recovered", "connected", "summary"].includes(event.event) ? "info" : "warn";
  log[level]("Audio pipeline", event);
}

/** Detect missing progress even while the operation being measured never returns. */
export class GapWatch {
  private last: number | undefined;
  private reported: number | undefined;
  private episode: PipelineContext | undefined;
  constructor(private emit: (event: PipelineDiagnostic) => void,
    private context: () => PipelineContext,
    private threshold = 100, private expected = 20) {}
  reset() { this.last = this.reported = undefined; this.episode = undefined; }
  tick(now: number) {
    if (this.last === undefined || now - this.last <= this.threshold) return;
    if (this.reported === undefined || now - this.reported >= 5000) {
      this.episode ??= this.context();
      this.emit({ ...this.episode, event: "gap", gapMs: Math.round(now - this.last - this.expected) });
      this.reported = now;
    }
  }
  progress(now: number) {
    this.tick(now);
    if (this.reported !== undefined) this.emit({ ...this.episode!, event: "recovered", gapMs: Math.round(now - this.last! - this.expected) });
    this.last = now; this.reported = undefined; this.episode = undefined;
  }
}

const events = new Set(["gap", "retry", "failed", "recovered", "connected", "disconnected", "summary", "packet_loss", "high_rtt", "stale_content", "encode_slow", "encode_failed", "closed", "relay_failed"]);
const phases = new Set(["source_read", "pcm_input", "encode", "transport", "egress"]);
const reasons = new Set(["timeout", "truncated", "connection_reset", "connection_aborted", "not_connected", "broken_pipe", "read_failed"]);
const metrics = ["attempt", "offset", "generation", "gapMs", "durationMs", "frames", "pcmFrames", "subscriptions", "bytesSent", "bytesReceived", "bytesLost", "packetsSent", "packetsLost", "staleFrames", "staleGroups", "staleBytes", "rttMs", "connected", "epoch"];
/** Bounded NDJSON with an allowlist: arbitrary native text/URLs never enter service logs. */
export async function readHelperEvents(stream: ReadableStream<Uint8Array>, ready: () => void, emit: (event: PipelineDiagnostic) => void) {
  const decoder = new TextDecoder(); let pending = "", oversized = false;
  for await (const bytes of stream) {
    const text = decoder.decode(bytes, { stream: true });
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf("\n", start), end = newline < 0 ? text.length : newline;
      if (!oversized) {
        if (pending.length + end - start > 4096) { pending = ""; oversized = true; }
        else pending += text.slice(start, end);
      }
      if (newline < 0) break;
      if (!oversized) {
        try {
          const value = JSON.parse(pending) as Record<string, unknown>;
          if (value.event === "ready") ready();
          else if (value.event === "diagnostic" && events.has(String(value.eventType)) &&
            ["source_server", "server_helper", "helper_upstream"].includes(String(value.stage))) {
            const event: PipelineDiagnostic = { stage: value.stage as PipelineStage, event: String(value.eventType) };
            if (phases.has(String(value.phase))) event.phase = String(value.phase);
            if (reasons.has(String(value.reason))) event.reason = String(value.reason);
            for (const key of metrics) {
              const metric = value[key];
              if (typeof metric === "number" && Number.isFinite(metric) && metric >= 0 || typeof metric === "boolean") event[key] = metric;
            }
            emit(event);
          }
        } catch { /* Incomplete/malformed diagnostics are not application messages. */ }
      }
      pending = ""; oversized = false; start = newline + 1;
    }
  }
}
