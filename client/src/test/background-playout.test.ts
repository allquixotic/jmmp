// Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { BackgroundPlayout, BACKGROUND_RESERVE_MS } from "../audio/background-playout";

test("V44 hidden rendering gets a bounded reserve without treating stale timers as jitter", () => {
  const scheduling = new BackgroundPlayout();
  expect(scheduling.sample(0)).toBe(true);
  expect(scheduling.delay(100, 0)).toBe(100);
  scheduling.visibility(true, 250);
  expect(scheduling.delay(100, 250)).toBe(BACKGROUND_RESERVE_MS);
  expect(scheduling.delay(3200, 250)).toBe(3200);
  expect(scheduling.sample(30000)).toBe(false);
  expect(scheduling.canConfirm(29900, 30000)).toBe(false);
  scheduling.visibility(false, 30000);
  expect(scheduling.sample(30000)).toBe(false);
  expect(scheduling.sample(30750)).toBe(false);
  expect(scheduling.sample(31000)).toBe(true);
  expect(scheduling.delay(100, 31000)).toBe(BACKGROUND_RESERVE_MS);
  expect(scheduling.delay(100, 40000)).toBe(100);
});

test("V44 a throttled foreground callback restarts evidence; genuine fresh gaps remain detectable", () => {
  const scheduling = new BackgroundPlayout();
  scheduling.sample(0);
  expect(scheduling.sample(10000)).toBe(false);
  expect(scheduling.canConfirm(250, 10000)).toBe(false);
  for (let now = 10250; now < 11000; now += 250) expect(scheduling.sample(now)).toBe(false);
  expect(scheduling.sample(11000)).toBe(true);
  expect(scheduling.canConfirm(11000, 11500)).toBe(true);
  expect(scheduling.canConfirm(11000, 12500)).toBe(false);
});
