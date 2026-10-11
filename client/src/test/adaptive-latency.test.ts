// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { AdaptiveLatency, LATENCY_STORAGE_KEY, RenderHealth } from "../audio/adaptive-latency";

function storage(value: string | null = null) {
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
}
function smooth(latency: AdaptiveLatency, start: number, end: number) {
  for (let t = start; t <= end; t += 250) { latency.healthy(t); latency.tick(t); }
}

test("V35 Resync forgets persisted floor, RTT, underruns and old quiet evidence", () => {
  const saved = storage('{"version":1,"targetMs":3200,"floorMs":3000}');
  const latency = new AdaptiveLatency(saved);
  latency.setRtt(2500); latency.underrun(0); smooth(latency, 0, 600000);
  latency.reset();
  expect(latency.targetMs).toBe(100); expect(latency.underruns).toBe(0);
  latency.tick(600250); expect(latency.targetMs).toBe(100);
  expect(new AdaptiveLatency(saved).targetMs).toBe(100);
  smooth(latency, 600250, 1200250); expect(latency.targetMs).toBe(95);
  const blocked = new AdaptiveLatency({ getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } });
  blocked.underrun(0); expect(() => blocked.reset()).not.toThrow();
  expect(blocked.targetMs).toBe(100);
});

test("V33 learned latency and safe floor survive refresh independently per origin", () => {
  const saved = storage(), other = storage();
  const latency = new AdaptiveLatency(saved); latency.boundary(0); latency.underrun(1000);
  const restored = new AdaptiveLatency(saved);
  expect(restored.targetMs).toBe(latency.targetMs);
  expect(new AdaptiveLatency(other).targetMs).toBe(100);
  restored.boundary(0); smooth(restored, 0, 590000);
  expect(restored.targetMs).toBe(latency.targetMs);
  smooth(restored, 590250, 601000);
  expect(restored.targetMs).toBe(latency.targetMs - 5);
  expect(new AdaptiveLatency(saved).targetMs).toBe(restored.targetMs);
  expect(LATENCY_STORAGE_KEY).toContain("jmmp");
});

test("V33 invalid or inaccessible local storage never breaks playback", () => {
  for (const value of ["bad", "null", "{}", '{"version":0,"targetMs":3200,"floorMs":25}',
    '{"version":1,"targetMs":99999,"floorMs":25}', '{"version":1,"targetMs":100,"floorMs":200}',
    '{"version":1,"targetMs":"3200","floorMs":25}']) {
    expect(new AdaptiveLatency(storage(value)).targetMs).toBe(100);
  }
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  const latency = new AdaptiveLatency(blocked);
  expect(() => latency.underrun(0)).not.toThrow();
  expect(latency.targetMs).toBeGreaterThan(100);
});

test("V34 arrival traffic alone never lowers delay; ten healthy minutes release only 5ms", () => {
  const latency = new AdaptiveLatency(storage()); latency.boundary(0);
  for (let t = 0; t <= 900000; t += 250) latency.tick(t);
  expect(latency.targetMs).toBe(100);
  smooth(latency, 900250, 1500250);
  expect(latency.targetMs).toBe(95);
  smooth(latency, 1500500, 1559500);
  expect(latency.targetMs).toBe(95);
  smooth(latency, 1559750, 1560500);
  expect(latency.targetMs).toBe(90);
});

test("V34 render gaps restart the quiet period; known failed budgets are never retried", () => {
  const saved = storage(), latency = new AdaptiveLatency(saved); latency.boundary(0);
  smooth(latency, 0, 600000); expect(latency.targetMs).toBe(95);
  latency.underrun(600250); const raised = latency.targetMs;
  smooth(latency, 600500, 1200000); expect(latency.targetMs).toBe(raised);
  latency.disturbed(1200000); smooth(latency, 1200250, 1799750);
  expect(latency.targetMs).toBe(raised);
  smooth(latency, 1800000, 10000000);
  expect(latency.targetMs).toBe(125); // failed 95ms + 25ms safety margin, rounded up
  expect(new AdaptiveLatency(saved).targetMs).toBe(125);
});

test("V32 boundaries retain learned delay and RTT floor stays finite and bounded", () => {
  const latency = new AdaptiveLatency(storage()); latency.boundary(0);
  latency.underrun(20); const target = latency.targetMs;
  latency.boundary(5000);
  latency.setRtt(40); latency.setRtt(NaN); latency.setRtt(Infinity); latency.tick(5020);
  expect(latency.targetMs).toBe(target);
  for (let i = 0; i < 100; i++) latency.underrun(5020 + i * 20);
  expect(latency.targetMs).toBe(5000);
  latency.setRtt(Infinity); latency.tick(NaN);
  expect(Number.isFinite(latency.targetMs)).toBe(true);
  const distant = new AdaptiveLatency(storage()); distant.setRtt(10000); distant.tick(0);
  expect(distant.targetMs).toBe(5000);
});

test("V34 render accounting detects recovered short gaps but accepts caught-up clocks and silence", () => {
  const health = new RenderHealth();
  expect(health.sample(0, 0)).toBe("warming");
  // Digital silence still advances the media clock normally.
  expect(health.sample(500, 500)).toBe("healthy");
  expect(health.sample(750, 700)).toBe("healthy");
  expect(health.sample(1000, 900)).toBe("warming");
  expect(health.sample(1250, 1100)).toBe("gap");
  health.reset(); health.sample(0, 0);
  // Delayed main-thread delivery catches up with the independently running worklet.
  expect(health.sample(3000, 3000)).toBe("healthy");
  expect(health.sample(3250, 3000)).toBe("gap");
  health.reset(); health.sample(90000, 1000);
  expect(health.sample(90500, 1500)).toBe("healthy");
  expect(health.sample(90600, 0)).toBe("warming"); // new timeline
});
