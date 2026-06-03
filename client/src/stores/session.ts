// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import { api, ApiError } from "src/api";
import type { AuthStatusResponse, MeResponse } from "@jmmp/shared";
import { tabLock } from "src/tabs/tab-lock";

interface State {
  statusLoaded: boolean;
  hasPasskeys: boolean;
  hasBootstrapToken: boolean;
  hasFullSession: boolean;
  hasRegistrationSession: boolean;
  me: MeResponse | null;
  playerConflict: { otherDeviceId: string } | null;
}

let unsubscribeTabLock: (() => void) | null = null;

export const useSessionStore = defineStore("session", {
  state: (): State => ({
    statusLoaded: false,
    hasPasskeys: false,
    hasBootstrapToken: false,
    hasFullSession: false,
    hasRegistrationSession: false,
    me: null,
    playerConflict: null,
  }),
  actions: {
    async refreshStatus(): Promise<void> {
      const data = await api.get<AuthStatusResponse>("/api/auth/status");
      this.hasPasskeys = data.hasPasskeys;
      this.hasBootstrapToken = data.hasBootstrapToken;
      this.hasFullSession = data.hasFullSession;
      this.hasRegistrationSession = data.hasRegistrationSession;
      this.statusLoaded = true;
      if (this.hasFullSession) {
        try {
          this.me = await api.get<MeResponse>("/api/me");
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            this.hasFullSession = false;
            this.me = null;
          } else {
            throw err;
          }
        }
      } else {
        this.me = null;
      }
    },
    startPlayerLock(): void {
      if (unsubscribeTabLock) return;
      unsubscribeTabLock = tabLock.onConflict((conflict) => {
        this.playerConflict = conflict;
      });
      tabLock.start();
    },
    stopPlayerLock(): void {
      unsubscribeTabLock?.();
      unsubscribeTabLock = null;
      this.playerConflict = null;
      tabLock.stop();
    },
    async takePlayerControl(): Promise<void> {
      await tabLock.takeControl();
      this.playerConflict = null;
    },
    async logout(): Promise<void> {
      try {
        await api.post("/api/auth/logout");
      } catch {
        /* ignore */
      }
      this.stopPlayerLock();
      this.$reset();
      await this.refreshStatus();
    },
  },
});
