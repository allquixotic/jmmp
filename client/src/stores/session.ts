// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import { api, ApiError } from "src/api";
import type { AuthStatusResponse, MeResponse } from "@jmmp/shared";
import { can, canControlPlayback } from "@jmmp/shared";
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
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;

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
  getters: {
    role: state => state.me?.role ?? null,
    isAdmin: state => state.me?.role === "admin",
    canEditPlaylists: state => can(state.me?.role, "playlistWrite"),
    canAddSources: state => can(state.me?.role, "sourceAdd"),
    canControl: state => canControlPlayback(state.me?.role, state.me?.moqEnabled ?? false),
    isObserver: state => state.me?.role === "viewer",
  },
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
      if (!this.hasFullSession || this.isObserver) this.stopPlayerLock();
      else this.startPlayerLock();
      if (this.hasFullSession && !refreshTimer) refreshTimer = setInterval(() => {
        if (refreshing) return;
        refreshing = true;
        void this.refreshStatus().catch(() => {}).finally(() => { refreshing = false; });
      }, 5000);
      if (!this.hasFullSession) { clearInterval(refreshTimer); refreshTimer = undefined; }
    },
    startPlayerLock(): void {
      if (!this.hasFullSession || this.isObserver) return;
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
      if (!this.canControl) throw new Error("This passkey cannot control playback in the current mode");
      await tabLock.takeControl();
      if (this.me) this.me.isPlayer = true;
      this.playerConflict = null;
    },
    async logout(): Promise<void> {
      try {
        await api.post("/api/auth/logout");
      } catch {
        /* ignore */
      }
      this.stopPlayerLock();
      clearInterval(refreshTimer); refreshTimer = undefined;
      this.$reset();
      await this.refreshStatus();
    },
  },
});
