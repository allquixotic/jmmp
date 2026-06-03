// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import {
  LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX,
  LONG_PRESS_CONTEXT_MENU_MS,
  movedPastContextMenuTolerance,
  shouldArmLongPressContextMenu,
  shouldOpenContextMenu,
} from "src/interactions/context-menu";

export const TRACK_ROW_LONG_PRESS_MS = LONG_PRESS_CONTEXT_MENU_MS;
export const TRACK_ROW_LONG_PRESS_MOVE_TOLERANCE_PX =
  LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX;

export function shouldArmTrackRowLongPress(
  pointerType: string,
  button: number
): boolean {
  return shouldArmLongPressContextMenu(pointerType, button);
}

export function movedPastLongPressTolerance(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  tolerance = TRACK_ROW_LONG_PRESS_MOVE_TOLERANCE_PX
): boolean {
  return movedPastContextMenuTolerance(
    startX,
    startY,
    currentX,
    currentY,
    tolerance
  );
}

export function shouldOpenTrackRowContextMenu(
  button: number,
  ctrlKey = false
): boolean {
  return shouldOpenContextMenu(button, ctrlKey);
}
