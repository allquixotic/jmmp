// Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0
export type MediaActions = Partial<Record<MediaSessionAction, (details: MediaSessionActionDetails) => void>>;
const actions: MediaSessionAction[] = ["play", "pause", "stop", "seekto", "seekbackward", "seekforward", "previoustrack", "nexttrack"];
let owner: PlaybackMediaSession | undefined;
type MediaSessionTarget = Pick<MediaSession, "metadata" | "playbackState" | "setActionHandler" | "setPositionState">;

/** One route owns OS controls; even previously retained callbacks obey the latest capabilities. */
export class PlaybackMediaSession {
  private handlers: MediaActions = {};
  constructor(private session: MediaSessionTarget | undefined = typeof navigator === "undefined" ? undefined : navigator.mediaSession) {
    owner?.dispose(); owner = this;
  }
  update(metadata: MediaMetadataInit | null, state: MediaSessionPlaybackState, handlers: MediaActions,
    position?: MediaPositionState): void {
    if (owner !== this || !this.session) return;
    this.handlers = handlers;
    try {
      this.session.metadata = metadata && typeof MediaMetadata !== "undefined" ? new MediaMetadata(metadata) : null;
      this.session.playbackState = state;
    } catch { /* Browser support varies independently for metadata/actions/position. */ }
    for (const action of actions) {
      try { this.session.setActionHandler(action, handlers[action] ? details => {
        if (owner === this) this.handlers[action]?.(details);
      } : null); } catch { /* This action may be unsupported. */ }
    }
    try { this.session.setPositionState(position); } catch { /* Live/unknown durations have no seekable timeline. */ }
  }
  dispose(): void {
    this.handlers = {};
    if (owner !== this) return;
    if (this.session) {
      for (const action of actions) { try { this.session.setActionHandler(action, null); } catch {} }
      try { this.session.metadata = null; this.session.playbackState = "none"; this.session.setPositionState(); } catch {}
    }
    owner = undefined;
  }
}
