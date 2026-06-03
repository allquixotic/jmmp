// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  movedPastLongPressTolerance,
  shouldOpenTrackRowContextMenu,
  shouldArmTrackRowLongPress,
} from "../tracks/row-interaction";

describe("track row interaction", () => {
  test("arms long press menus only for primary touch-like pointers", () => {
    expect(shouldArmTrackRowLongPress("touch", 0)).toBe(true);
    expect(shouldArmTrackRowLongPress("pen", 0)).toBe(true);
    expect(shouldArmTrackRowLongPress("mouse", 0)).toBe(false);
    expect(shouldArmTrackRowLongPress("touch", 2)).toBe(false);
  });

  test("cancels long press when the pointer moves beyond tolerance", () => {
    expect(movedPastLongPressTolerance(10, 10, 16, 18)).toBe(false);
    expect(movedPastLongPressTolerance(10, 10, 22, 10)).toBe(true);
  });

  test("opens desktop row menus only for right-click equivalents", () => {
    expect(shouldOpenTrackRowContextMenu(2)).toBe(true);
    expect(shouldOpenTrackRowContextMenu(0, true)).toBe(true);
    expect(shouldOpenTrackRowContextMenu(0)).toBe(false);
    expect(shouldOpenTrackRowContextMenu(1)).toBe(false);
  });
});
