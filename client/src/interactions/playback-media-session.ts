// Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0
import { watchEffect } from "vue";
import { PlaybackMediaSession, type MediaActions } from "src/audio/media-session";
import { usePlayerStore } from "src/stores/player";
import { useQueueStore } from "src/stores/queue";
import { useSessionStore } from "src/stores/session";

/** OS playback keys never silently take control from a different tab/device. */
export function installControllerMediaSession(): () => void {
  const player = usePlayerStore(), session = useSessionStore(), queue = useQueueStore();
  const media = new PlaybackMediaSession();
  const allowed = () => session.hasFullSession && session.canControl && session.me?.isPlayer === true;
  const guarded = (run: (details: MediaSessionActionDetails) => void) => (details: MediaSessionActionDetails) => {
    if (allowed()) run(details);
  };
  const handlers: MediaActions = {
    play: guarded(() => { if (player.state === "paused") player.resume(); }),
    pause: guarded(() => player.pause()), stop: guarded(() => player.stop()),
    seekto: guarded(details => { if (details.seekTime !== undefined) void player.seek(details.seekTime); }),
    seekbackward: guarded(details => { void player.seek(Math.max(0, player.position - (details.seekOffset ?? 10))); }),
    seekforward: guarded(details => { void player.seek(Math.min(player.duration, player.position + (details.seekOffset ?? 10))); }),
    nexttrack: guarded(() => { const track = queue.next(); if (track) void player.play(track, false); }),
    previoustrack: guarded(() => { const track = queue.prev(); if (track) void player.play(track, false); }),
  };
  const unwatch = watchEffect(() => {
    const track = session.hasFullSession ? player.current : null;
    const controls = track && allowed() ? { ...handlers } : {};
    if (queue.index <= 0) delete controls.previoustrack;
    if (queue.index < 0 || queue.index + 1 >= queue.entries.length) delete controls.nexttrack;
    const duration = player.duration;
    media.update(track ? { title: track.title ?? "Untitled track", artist: track.artist ?? "Unknown artist", album: track.album ?? "" } : null,
      !track ? "none" : player.state === "playing" ? "playing" : "paused", controls,
      track && allowed() && Number.isFinite(duration) && duration > 0 ? {
        duration, position: Math.max(0, Math.min(duration, player.position)),
      } : undefined);
  });
  return () => { unwatch(); media.dispose(); };
}
