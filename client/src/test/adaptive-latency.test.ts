// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { AdaptiveLatency } from "../audio/adaptive-latency";

test("V32 steady arrival converges near 50ms total Opus playout, independently per receiver", () => {
  const stable = new AdaptiveLatency(), jittery = new AdaptiveLatency();
  stable.boundary(0); jittery.boundary(0);
  for (let t = 0; t <= 10000; t += 20) { stable.observe(t, t); stable.tick(t); }
  jittery.underrun(1000); jittery.underrun(2000);
  expect(stable.targetMs).toBe(25);
  expect(jittery.targetMs).toBeGreaterThan(200);
});

test("V32 burst jitter and underruns raise the budget, stable playback lowers it slowly", () => {
  const latency = new AdaptiveLatency(); latency.boundary(0);
  for (let t = 0; t < 1000; t += 20) latency.observe(t, t);
  latency.observe(1300, 1000);
  expect(latency.targetMs).toBeGreaterThanOrEqual(320);
  for (let t = 1320; t < 1400; t += 20) { latency.observe(t, t); latency.tick(t); }
  latency.underrun(1400);
  const raised = latency.targetMs;
  for (let t = 1420; t < 20000; t += 20) { latency.observe(t, t); latency.tick(t); }
  expect(latency.targetMs).toBe(raised);
  for (let t = 20000; t <= 40000; t += 20) { latency.observe(t, t); latency.tick(t); }
  expect(latency.targetMs).toBeLessThan(raised);
  expect(latency.targetMs).toBeGreaterThan(raised - 60);
});

test("V32 proactive jitter growth receives the same cooldown as a rendered underrun", () => {
  const latency = new AdaptiveLatency(); latency.boundary(0);
  for (let t = 0; t < 1000; t += 20) latency.observe(t, t);
  latency.observe(1400, 1000); const raised = latency.targetMs;
  for (let t = 1420; t < 20000; t += 20) { latency.observe(t, t); latency.tick(t); }
  expect(latency.underruns).toBe(0);
  expect(latency.targetMs).toBe(raised);
});

test("V32 boundaries preserve learned delay, excluding stale and invalid observations", () => {
  const latency = new AdaptiveLatency(); latency.boundary(0);
  latency.underrun(20); const target = latency.targetMs;
  latency.boundary(5000);
  latency.observe(5000, 90000); latency.observe(5020, 90020);
  latency.observe(99999, 90000); latency.observe(NaN, Infinity);
  expect(latency.targetMs).toBe(target);
  for (let i = 0; i < 100; i++) latency.underrun(5020 + i * 20);
  expect(latency.targetMs).toBe(5000);
  latency.setRtt(Infinity); latency.tick(NaN);
  expect(Number.isFinite(latency.targetMs)).toBe(true);
});
