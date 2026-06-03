// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  reloadOnceOnControllerChange,
  requestWaitingWorkerActivation,
  type ControllerChangeSource,
  type ReloadTarget,
} from "../../src-pwa/service-worker-update.ts";

class FakeControllerChangeSource implements ControllerChangeSource {
  private listener: (() => void) | null = null;

  addEventListener(type: "controllerchange", listener: () => void): void {
    if (type === "controllerchange") this.listener = listener;
  }

  fire(): void {
    this.listener?.();
  }
}

describe("service worker update handling", () => {
  test("reloads once when a new service worker takes control", () => {
    const source = new FakeControllerChangeSource();
    let reloads = 0;
    const target: ReloadTarget = { reload: () => reloads++ };

    reloadOnceOnControllerChange(source, target);
    source.fire();
    source.fire();

    expect(reloads).toBe(1);
  });

  test("asks a waiting worker to activate", () => {
    const messages: unknown[] = [];
    requestWaitingWorkerActivation({
      waiting: { postMessage: (message: unknown) => messages.push(message) },
    } as ServiceWorkerRegistration);

    expect(messages).toEqual([{ type: "SKIP_WAITING" }]);
  });
});
