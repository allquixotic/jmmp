// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { GapWatch, readHelperEvents, type PipelineDiagnostic } from "../audio/diagnostics.ts";
import { NativeOutput } from "../audio/helper.ts";

test("V36 gaps log while blocked, repeat slowly, recover once, and ignore intentional boundaries", () => {
  const events: PipelineDiagnostic[] = [];
  const watch = new GapWatch(event => events.push(event), () => ({ stage: "source_server", phase: "source_read", generation: 7 }));
  watch.progress(0); watch.tick(99); expect(events).toHaveLength(0);
  watch.tick(120); watch.tick(500); watch.tick(5119);
  expect(events).toHaveLength(1);
  watch.tick(5120); expect(events).toHaveLength(2);
  watch.progress(5500); expect(events.at(-1)?.event).toBe("recovered");
  expect(events.at(-1)?.gapMs).toBe(5480);
  watch.reset(); watch.tick(100000); expect(events).toHaveLength(3);
  watch.progress(100000); watch.progress(100500); // blocked event loop, still diagnosed on return
  expect(events.slice(-2).map(event => event.event)).toEqual(["gap", "recovered"]);
  expect(events.every(event => event.generation === 7 && event.phase === "source_read")).toBe(true);
});

test("V36 actual pipe backpressure warns before flush returns and records recovery", async () => {
  const output = new NativeOutput(), events: PipelineDiagnostic[] = [];
  let release!: () => void;
  const blocked = new Promise<number>(resolve => { release = () => resolve(0); });
  // Substitute only the OS pipe. Exercise the production write queue/monitor.
  (output as unknown as { child: unknown }).child = { stdin: { write() {}, flush: () => blocked } };
  output.alive = true; output.onDiagnostic = event => events.push(event);
  const write = output.write(0, 9, new Float32Array(1920));
  try {
    await Bun.sleep(200);
    expect(events.some(event => event.event === "gap" && event.phase === "pipe_flush" && event.generation === 9)).toBe(true);
  } finally { release(); await write; }
  expect(events.at(-1)?.event).toBe("recovered");
  expect(events.at(-1)?.gapMs).toBeGreaterThan(100);
});

test("V36 native stdout remains drained past ready; chunks and hostile diagnostics stay bounded and credential-free", async () => {
  const events: PipelineDiagnostic[] = [], encoder = new TextEncoder(); let ready = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoder.encode('{"event":"rea'));
    controller.enqueue(encoder.encode('dy"}\n{"event":"diagnostic","stage":"helper_upstream","eventType":"packet_loss","packetsLost":3,"url":"https://secret/token"}\n'));
    controller.enqueue(encoder.encode("x".repeat(100000)));
    controller.enqueue(encoder.encode('\n{"event":"diagnostic","stage":"server_helper","eventType":"gap","gapMs":500,"generation":2}\n'));
    controller.close();
  }});
  await readHelperEvents(stream, () => { ready++; }, event => events.push(event));
  expect(ready).toBe(1);
  expect(events.map(event => event.event)).toEqual(["packet_loss", "gap"]);
  expect(events[0]?.packetsLost).toBe(3);
  expect(JSON.stringify(events)).not.toContain("secret");
});
