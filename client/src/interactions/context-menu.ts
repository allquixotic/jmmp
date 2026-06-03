// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export const LONG_PRESS_CONTEXT_MENU_MS = 550;
export const LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX = 10;

export function shouldArmLongPressContextMenu(
  pointerType: string,
  button: number
): boolean {
  return pointerType !== "mouse" && button === 0;
}

export function movedPastContextMenuTolerance(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  tolerance = LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > tolerance;
}

export function shouldOpenContextMenu(button: number, ctrlKey = false): boolean {
  return button === 2 || (button === 0 && ctrlKey);
}
