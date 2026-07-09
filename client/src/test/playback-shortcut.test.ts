// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { handlePlaybackShortcut } from "src/interactions/playback-shortcut";

interface FakeKeyboardEventOptions {
  key?: string;
  defaultPrevented?: boolean;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}

function fakeKeyboardEvent(options: FakeKeyboardEventOptions = {}) {
  let prevented = false;
  const event = {
    key: " ",
    defaultPrevented: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    preventDefault: () => {
      prevented = true;
    },
    ...options,
  } as KeyboardEvent;
  return { event, wasPrevented: () => prevented };
}

function fakeDocument(hasActiveModal = false): Pick<Document, "querySelector"> {
  return {
    querySelector: () => (hasActiveModal ? ({} as Element) : null),
  };
}

function interactiveTarget(): EventTarget {
  return {
    closest: () => ({} as Element),
  } as unknown as EventTarget;
}

function playbackSurfaceTarget(): EventTarget {
  return {
    matches: (selector: string) =>
      selector === "[data-playback-shortcut-surface]",
    closest: () => ({} as Element),
  } as unknown as EventTarget;
}

describe("global playback shortcut", () => {
  test("plain Space toggles playback and prevents page scrolling", () => {
    const { event, wasPrevented } = fakeKeyboardEvent();
    let toggleCalls = 0;

    const handled = handlePlaybackShortcut(
      event,
      () => {
        toggleCalls += 1;
      },
      fakeDocument()
    );

    expect(handled).toBe(true);
    expect(toggleCalls).toBe(1);
    expect(wasPrevented()).toBe(true);
  });

  test("ignores non-Space, repeated, modified, and already-handled keys", () => {
    const ignoredEvents: FakeKeyboardEventOptions[] = [
      { key: "Enter" },
      { repeat: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { defaultPrevented: true },
    ];

    for (const options of ignoredEvents) {
      const { event, wasPrevented } = fakeKeyboardEvent(options);
      let toggleCalls = 0;
      expect(
        handlePlaybackShortcut(event, () => toggleCalls++, fakeDocument())
      ).toBe(false);
      expect(toggleCalls).toBe(0);
      expect(wasPrevented()).toBe(false);
    }
  });

  test("leaves Space to editable and interactive controls", () => {
    const { event, wasPrevented } = fakeKeyboardEvent({
      target: interactiveTarget(),
    });
    let toggleCalls = 0;

    expect(
      handlePlaybackShortcut(event, () => toggleCalls++, fakeDocument())
    ).toBe(false);
    expect(toggleCalls).toBe(0);
    expect(wasPrevented()).toBe(false);
  });

  test("plain Space still toggles after a track row receives focus", () => {
    const { event, wasPrevented } = fakeKeyboardEvent({
      target: playbackSurfaceTarget(),
    });
    let toggleCalls = 0;

    expect(
      handlePlaybackShortcut(event, () => toggleCalls++, fakeDocument())
    ).toBe(true);
    expect(toggleCalls).toBe(1);
    expect(wasPrevented()).toBe(true);
  });

  test("does not toggle playback while a modal is active", () => {
    const { event, wasPrevented } = fakeKeyboardEvent();
    let toggleCalls = 0;

    expect(
      handlePlaybackShortcut(event, () => toggleCalls++, fakeDocument(true))
    ).toBe(false);
    expect(toggleCalls).toBe(0);
    expect(wasPrevented()).toBe(false);
  });
});
