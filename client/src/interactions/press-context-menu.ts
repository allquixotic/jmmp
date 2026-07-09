// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { onBeforeUnmount, ref, shallowRef } from "vue";
import {
  LONG_PRESS_CONTEXT_MENU_MS,
  movedPastContextMenuTolerance,
  shouldArmLongPressContextMenu,
  shouldOpenContextMenu,
} from "./context-menu";

interface PressState {
  pointerId: number;
  key: string | number;
  startX: number;
  startY: number;
  timeoutId: number;
  opened: boolean;
}

interface PressContextMenuOptions<T> {
  keyFor: (item: T) => string | number;
  open: (event: MouseEvent | PointerEvent, item: T) => void;
}

export function usePressContextMenu<T>(options: PressContextMenuOptions<T>) {
  const suppressNextClickKey = ref<string | number | null>(null);
  const suppressContextMenuUntil = ref(0);
  const pressState = shallowRef<PressState | null>(null);

  function consumeClick(event: MouseEvent, item: T): boolean {
    const key = options.keyFor(item);
    if (suppressNextClickKey.value !== key) return false;
    suppressNextClickKey.value = null;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function onContextMenu(event: MouseEvent, item: T): void {
    if (Date.now() < suppressContextMenuUntil.value) return;
    if (!shouldOpenContextMenu(event.button, event.ctrlKey)) return;
    cancelLongPress();
    options.open(event, item);
  }

  function onPointerDown(event: PointerEvent, item: T): void {
    if (!shouldArmLongPressContextMenu(event.pointerType, event.button)) return;
    cancelLongPress();
    const key = options.keyFor(item);
    const timeoutId = window.setTimeout(() => {
      const state = pressState.value;
      if (!state || state.pointerId !== event.pointerId) return;
      state.opened = true;
      suppressNextClickKey.value = key;
      suppressContextMenuUntil.value = Date.now() + 1000;
      options.open(event, item);
    }, LONG_PRESS_CONTEXT_MENU_MS);
    pressState.value = {
      pointerId: event.pointerId,
      key,
      startX: event.clientX,
      startY: event.clientY,
      timeoutId,
      opened: false,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    const state = pressState.value;
    if (!state || state.pointerId !== event.pointerId || state.opened) return;
    if (
      movedPastContextMenuTolerance(
        state.startX,
        state.startY,
        event.clientX,
        event.clientY
      )
    ) {
      cancelLongPress();
    }
  }

  function onPointerEnd(event: PointerEvent): void {
    const opened = pressState.value?.opened === true;
    cancelLongPress(event.pointerId);
    if (opened) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onKeyDown(event: KeyboardEvent, item: T): void {
    const isContextMenuKey = event.key === "ContextMenu";
    const isShiftF10 = event.shiftKey && event.key === "F10";
    if (!isContextMenuKey && !isShiftF10) return;

    cancelLongPress();
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
    options.open(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: rect ? rect.left + Math.min(32, rect.width / 2) : 0,
        clientY: rect ? rect.top + Math.min(32, rect.height / 2) : 0,
      }),
      item
    );
  }

  function cancelLongPress(pointerId?: number): void {
    const state = pressState.value;
    if (!state || (pointerId !== undefined && state.pointerId !== pointerId)) return;
    window.clearTimeout(state.timeoutId);
    pressState.value = null;
  }

  onBeforeUnmount(() => cancelLongPress());

  return {
    consumeClick,
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    onKeyDown,
  };
}
