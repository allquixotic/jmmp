// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

const INTERACTIVE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "area[href]",
  "summary",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const ACTIVE_MODAL_SELECTOR = [
  "dialog[open]",
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
].join(",");

type ShortcutDocument = Pick<Document, "querySelector">;

export function handlePlaybackShortcut(
  event: KeyboardEvent,
  togglePlayback: () => void,
  root: ShortcutDocument = document
): boolean {
  if (
    event.key !== " " ||
    event.defaultPrevented ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isInteractiveTarget(event.target) ||
    root.querySelector(ACTIVE_MODAL_SELECTOR) !== null
  ) {
    return false;
  }

  event.preventDefault();
  togglePlayback();
  return true;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as Element;
  if (
    typeof element.matches === "function" &&
    element.matches("[data-playback-shortcut-surface]")
  ) {
    return false;
  }
  return element.closest(INTERACTIVE_TARGET_SELECTOR) !== null;
}
