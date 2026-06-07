// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export interface WakeLockSentinelLike extends EventTarget {
  release(): Promise<void>;
}

export interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export interface WakeLockNavigatorLike {
  wakeLock?: WakeLockLike;
}

export interface WakeLockDocumentLike {
  visibilityState: "visible" | "hidden" | "prerender" | "unloaded";
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PlaybackWakeLockController {
  setActive(active: boolean): void;
}

export class PlaybackWakeLock implements PlaybackWakeLockController {
  private active = false;
  private listening = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private requestInFlight: Promise<void> | null = null;

  constructor(
    private readonly doc: WakeLockDocumentLike,
    private readonly nav: WakeLockNavigatorLike
  ) {}

  setActive(active: boolean): void {
    if (this.active === active) {
      if (active) void this.acquire();
      return;
    }

    this.active = active;
    if (active) {
      this.listen();
      void this.acquire();
    } else {
      this.unlisten();
      this.releaseCurrent();
    }
  }

  private listen(): void {
    if (this.listening) return;
    this.doc.addEventListener("visibilitychange", this.onVisibilityChange);
    this.listening = true;
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.doc.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.listening = false;
  }

  private async acquire(): Promise<void> {
    if (
      !this.active ||
      this.sentinel ||
      this.requestInFlight ||
      this.doc.visibilityState !== "visible" ||
      !this.nav.wakeLock
    ) {
      return;
    }

    this.requestInFlight = this.nav.wakeLock
      .request("screen")
      .then(async (sentinel) => {
        if (!this.active || this.doc.visibilityState !== "visible") {
          await sentinel.release().catch(() => {});
          return;
        }
        this.sentinel = sentinel;
        sentinel.addEventListener("release", this.onSentinelRelease, { once: true });
      })
      .catch(() => {})
      .finally(() => {
        this.requestInFlight = null;
      });
    await this.requestInFlight;
  }

  private releaseCurrent(): void {
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => {});
  }

  private onVisibilityChange = (): void => {
    if (!this.active) return;
    if (this.doc.visibilityState === "visible") {
      void this.acquire();
    } else {
      this.releaseCurrent();
    }
  };

  private onSentinelRelease = (): void => {
    this.sentinel = null;
  };
}

export function createPlaybackWakeLock(): PlaybackWakeLock | null {
  const globals = globalThis as typeof globalThis & {
    document?: WakeLockDocumentLike;
    navigator?: WakeLockNavigatorLike;
  };
  if (!globals.document || !globals.navigator) return null;
  return new PlaybackWakeLock(globals.document, globals.navigator);
}
