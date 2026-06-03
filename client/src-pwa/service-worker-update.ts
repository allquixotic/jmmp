// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export interface ControllerChangeSource {
  addEventListener(type: "controllerchange", listener: () => void): void;
}

export interface ReloadTarget {
  reload(): void;
}

export function reloadOnceOnControllerChange(
  source: ControllerChangeSource,
  target: ReloadTarget
): void {
  let reloading = false;
  source.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    target.reload();
  });
}

export function requestWaitingWorkerActivation(
  registration: ServiceWorkerRegistration
): void {
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
}
