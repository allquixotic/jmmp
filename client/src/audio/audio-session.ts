// Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0
export interface PlaybackSessionNavigator {
  audioSession?: { type: string };
}

/** Safari otherwise classifies Web Audio as ambient audio. Best effort on all browsers. */
export function requestPlaybackAudioSession(nav: PlaybackSessionNavigator | undefined =
  typeof navigator === "undefined" ? undefined : navigator as PlaybackSessionNavigator): void {
  try { if (nav?.audioSession) nav.audioSession.type = "playback"; }
  catch { /* Unsupported categories must not prevent ordinary playback. */ }
}
