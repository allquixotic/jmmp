// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { ReplayGainMode } from "@jmmp/shared";
import type { Track } from "@jmmp/shared";

export function computeGainDb(
  track: Track,
  mode: ReplayGainMode,
  preampDb: number
): number {
  if (mode === "off") return 0;
  const trackGain = track.rgTrackDb ?? null;
  const albumGain = track.rgAlbumDb ?? null;
  let chosen: number | null = null;
  switch (mode) {
    case "track":
      chosen = trackGain;
      break;
    case "album":
      chosen = albumGain;
      break;
    case "album-fallback-track":
      chosen = albumGain ?? trackGain;
      break;
  }
  if (chosen === null) return 0;
  return chosen + preampDb;
}
