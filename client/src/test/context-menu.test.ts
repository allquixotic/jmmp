// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  movedPastContextMenuTolerance,
  shouldArmLongPressContextMenu,
  shouldOpenContextMenu,
} from "src/interactions/context-menu";

describe("context menu interaction", () => {
  test("arms long press menus only for primary touch-like pointers", () => {
    expect(shouldArmLongPressContextMenu("touch", 0)).toBe(true);
    expect(shouldArmLongPressContextMenu("pen", 0)).toBe(true);
    expect(shouldArmLongPressContextMenu("mouse", 0)).toBe(false);
    expect(shouldArmLongPressContextMenu("touch", 2)).toBe(false);
  });

  test("cancels long press when pointer movement exceeds tolerance", () => {
    expect(movedPastContextMenuTolerance(10, 10, 16, 18)).toBe(false);
    expect(movedPastContextMenuTolerance(10, 10, 22, 10)).toBe(true);
  });

  test("opens desktop menus only for right-click equivalents", () => {
    expect(shouldOpenContextMenu(2)).toBe(true);
    expect(shouldOpenContextMenu(0, true)).toBe(true);
    expect(shouldOpenContextMenu(0)).toBe(false);
    expect(shouldOpenContextMenu(1)).toBe(false);
  });
});
