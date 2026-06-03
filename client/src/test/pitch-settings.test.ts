// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  clampPitchHudState,
  DEFAULT_PITCH_HUD,
  PITCH_RANGE_SEMI,
  SPEED_PCT_MAX,
  SPEED_PCT_MIN,
  TEMPO_PCT_MAX,
  TEMPO_PCT_MIN,
} from "@jmmp/shared";

describe("pitch settings", () => {
  test("uses the tight UI ranges", () => {
    expect(PITCH_RANGE_SEMI).toBe(5);
    expect(TEMPO_PCT_MIN).toBe(-50);
    expect(TEMPO_PCT_MAX).toBe(100);
    expect(SPEED_PCT_MIN).toBe(-50);
    expect(SPEED_PCT_MAX).toBe(100);
  });

  test("clamps saved pitch HUD values into the current range", () => {
    expect(
      clampPitchHudState({
        ...DEFAULT_PITCH_HUD,
        pitchSemi: 80,
        tempoPct: -90,
        speedPct: 500,
      })
    ).toMatchObject({
      pitchSemi: 5,
      tempoPct: -50,
      speedPct: 100,
    });
  });
});
