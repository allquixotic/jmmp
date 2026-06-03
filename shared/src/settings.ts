// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export interface PitchHudState {
  pitchSemi: number;
  tempoPct: number;
  speedPct: number;
  x: number;
  y: number;
  collapsed: boolean;
}

export const DEFAULT_PITCH_HUD: PitchHudState = {
  pitchSemi: 0,
  tempoPct: 0,
  speedPct: 0,
  x: 24,
  y: 24,
  collapsed: false,
};

export type ReplayGainMode = "off" | "track" | "album" | "album-fallback-track";

export type LibraryView = "list" | "grid";

export interface UserSettings {
  pitchHud: PitchHudState;
  replayGainMode: ReplayGainMode;
  replayGainPreampDb: number;
  opfsCacheCapBytes: number;
  artCacheCapBytes: number;
  qobuzPreferredFormatId: 5 | 6 | 7 | 27;
  libraryView: LibraryView;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  pitchHud: DEFAULT_PITCH_HUD,
  replayGainMode: "off",
  replayGainPreampDb: 0,
  opfsCacheCapBytes: 2 * 1024 * 1024 * 1024,
  artCacheCapBytes: 200 * 1024 * 1024,
  qobuzPreferredFormatId: 27,
  libraryView: "list",
};

export function clampLibraryView(value: unknown): LibraryView {
  return value === "grid" ? "grid" : "list";
}

export const PITCH_RANGE_SEMI = 5;
export const TEMPO_PCT_MIN = -50;
export const TEMPO_PCT_MAX = 100;
export const SPEED_PCT_MIN = -50;
export const SPEED_PCT_MAX = 100;

export function clampPitchHudState(state: PitchHudState): PitchHudState {
  return {
    ...state,
    pitchSemi: clamp(state.pitchSemi, -PITCH_RANGE_SEMI, PITCH_RANGE_SEMI),
    tempoPct: clamp(state.tempoPct, TEMPO_PCT_MIN, TEMPO_PCT_MAX),
    speedPct: clamp(state.speedPct, SPEED_PCT_MIN, SPEED_PCT_MAX),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}
