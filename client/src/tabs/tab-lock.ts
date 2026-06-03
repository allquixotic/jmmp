// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { api, ApiError } from "src/api";
import type { MeResponse } from "@jmmp/shared";

type ConflictListener = (conflict: { otherDeviceId: string } | null) => void;

const HEARTBEAT_MS = 10_000;

class TabLock {
  private interval: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<ConflictListener>();
  private active = false;

  start(): void {
    if (this.active) return;
    this.active = true;
    if (typeof BroadcastChannel === "function") {
      this.channel = new BroadcastChannel("jmmp");
      this.channel.onmessage = (e) => {
        if (e.data?.type === "claim-player") {
          this.notify({ otherDeviceId: e.data.deviceId ?? "" });
        }
      };
    }
    this.interval = setInterval(() => void this.tick(), HEARTBEAT_MS);
    void this.tick();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.channel?.close();
    this.channel = null;
    this.active = false;
  }

  onConflict(fn: ConflictListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async takeControl(): Promise<void> {
    await api.post("/api/take-control");
    this.channel?.postMessage({
      type: "claim-player",
      deviceId: crypto.randomUUID(),
    });
    this.notify(null);
  }

  private async tick(): Promise<void> {
    try {
      await api.post("/api/heartbeat");
      const me = await api.get<MeResponse>("/api/me");
      if (me.playerConflict) {
        this.notify({ otherDeviceId: me.playerConflict.otherDeviceId });
      } else {
        this.notify(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.stop();
    }
  }

  private notify(conflict: { otherDeviceId: string } | null): void {
    for (const fn of this.listeners) fn(conflict);
  }
}

export const tabLock = new TabLock();
