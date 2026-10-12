// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import { api } from "src/api";
import {
  clampLibraryView,
  clampPitchHudState,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
} from "@jmmp/shared";

import { useSessionStore } from "./session";

interface State {
  settings: UserSettings;
  loaded: boolean;
  saving: boolean;
}

let saveTimer: number | undefined;

export const useSettingsStore = defineStore("settings", {
  state: (): State => ({
    settings: structuredClone(DEFAULT_USER_SETTINGS),
    loaded: false,
    saving: false,
  }),
  actions: {
    async load(): Promise<void> {
      const resp = await api.get<{ settings: UserSettings }>("/api/settings");
      this.settings = normalizeSettings(resp.settings);
      try {
        const local = JSON.parse(localStorage.getItem("jmmp-view-preferences") ?? "null") as { libraryView?: unknown } | null;
        if (local?.libraryView) this.settings.libraryView = clampLibraryView(local.libraryView);
      } catch { /* storage is optional */ }
      this.loaded = true;
    },
    patch(partial: Partial<UserSettings>): void {
      if (partial.libraryView !== undefined) {
        this.settings.libraryView = clampLibraryView(partial.libraryView);
        try { localStorage.setItem("jmmp-view-preferences", JSON.stringify({ libraryView: this.settings.libraryView })); } catch { /* optional */ }
      }
      if (!useSessionStore().canControl) return;
      this.settings = normalizeSettings({ ...this.settings, ...partial });
      if (Object.keys(partial).some(key => key !== "libraryView")) this.scheduleSave();
    },
    scheduleSave(): void {
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = self.setTimeout(() => void this.flush(), 250);
    },
    async flush(): Promise<void> {
      const session = useSessionStore();
      if (!session.canControl) return;
      if (!session.me?.isPlayer) await session.takePlayerControl();
      this.saving = true;
      try {
        await api.put<{ settings: UserSettings }>("/api/settings", {
          settings: this.settings,
        });
      } finally {
        this.saving = false;
      }
    },
  },
});

function normalizeSettings(settings: Partial<UserSettings>): UserSettings {
  const merged = { ...DEFAULT_USER_SETTINGS, ...settings };
  return {
    ...merged,
    pitchHud: clampPitchHudState({
      ...DEFAULT_USER_SETTINGS.pitchHud,
      ...(settings.pitchHud ?? merged.pitchHud),
    }),
    libraryView: clampLibraryView(merged.libraryView),
  };
}
