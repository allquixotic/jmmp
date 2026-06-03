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
      this.loaded = true;
    },
    patch(partial: Partial<UserSettings>): void {
      this.settings = normalizeSettings({ ...this.settings, ...partial });
      this.scheduleSave();
    },
    scheduleSave(): void {
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = self.setTimeout(() => void this.flush(), 250);
    },
    async flush(): Promise<void> {
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
