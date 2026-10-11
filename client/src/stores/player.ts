// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import type { Track } from "@jmmp/shared";
import { AudioPlayer, cacheTrack, type PlayerState } from "src/audio/pipeline";
import { UnavailableTrackError, playbackErrorText, type UnavailableTrackEvent } from "src/audio/playback-error";
import { RoutingPlayer } from "src/audio/routing-player";
import { computeGainDb } from "src/audio/replaygain";
import { useSettingsStore } from "./settings";
import { api } from "src/api";
import { useQueueStore } from "./queue";
import { useSourcesStore } from "./sources";
import { getCacheEntry, pin as pinCachedTrack } from "src/storage/opfs-cache";
import type { CachePolicy } from "@jmmp/shared";
import { useSessionStore } from "./session";
import {
  createPlaybackWakeLock,
  type PlaybackWakeLockController,
} from "src/audio/wake-lock";

interface PlayerBackend extends EventTarget {
  play(track: Track, cacheOptions?: Parameters<AudioPlayer["play"]>[1]): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  seek(seconds: number): Promise<void>;
  setParams(p: Parameters<AudioPlayer["setParams"]>[0]): void;
  setVolume(volume: number): void;
  refreshOutput?(reconnect?: boolean): Promise<void>;
}

let player: PlayerBackend | null = null;
let createPlayerBackend = (): PlayerBackend => new RoutingPlayer();
let playbackWakeLock: PlaybackWakeLockController | null | undefined;
let createPlaybackWakeLockController = (): PlaybackWakeLockController | null =>
  createPlaybackWakeLock();

interface State {
  state: PlayerState;
  current: Track | null;
  position: number;
  duration: number;
  error: string | null;
  volume: number;
  pinned: Record<string, boolean>;
  moqEnabled: boolean;
  attempt: number;
  skippedAttempt: number;
  diagnostics: Array<{ trackId: number; title: string; artist: string; error: string; at: number; skipped: boolean }>;
}

export const usePlayerStore = defineStore("player", {
  state: (): State => ({
    state: "idle",
    current: null,
    position: 0,
    duration: 0,
    error: null,
    volume: 1,
    pinned: {},
    moqEnabled: false,
    attempt: 0, skippedAttempt: -1, diagnostics: [],
  }),
  getters: {
    currentPinned: (state): boolean =>
      state.current ? !!state.pinned[String(state.current.id)] : false,
  },
  actions: {
    ensure(): PlayerBackend {
      if (player) return player;
      player = createPlayerBackend();
      player.addEventListener("mode", event => { this.moqEnabled = (event as CustomEvent).detail; });
      player.addEventListener("state", (e) => {
        this.state = (e as CustomEvent).detail;
        setPlaybackWakeLockActive(this.state === "playing");
        this.error = this.state === "error" ? this.error : null;
        if (this.state === "ended") void this.onEnded();
      });
      player.addEventListener("position", (e) => {
        const d = (e as CustomEvent).detail;
        this.position = d.position;
        this.duration = d.duration;
      });
      player.addEventListener("error", (e) => {
        this.error = (e as CustomEvent).detail;
      });
      player.addEventListener("unavailable", (e) => {
        const detail = (e as CustomEvent<UnavailableTrackEvent>).detail;
        if (detail.trackId === this.current?.id) void this.skipUnavailable(detail.error);
      });
      return player;
    },
    async play(track: Track): Promise<void> {
      const attempt = ++this.attempt;
      this.current = track;
      this.position = 0;
      this.duration = track.durationMs / 1000;
      this.error = null;
      this.state = "loading";
      try {
        const session = useSessionStore();
        if (session.hasFullSession) await session.takePlayerControl();
        const settings = useSettingsStore();
        const gainDb = computeGainDb(
          track,
          settings.settings.replayGainMode,
          settings.settings.replayGainPreampDb
        );
        if (attempt !== this.attempt) return;
        this.ensure().setParams({ gainDb });
        const pinned = await this.loadPinState(track.id);
        const policy = await this.cachePolicyFor(track.sourceId);
        if (attempt !== this.attempt) return;
        await this.ensure().play(track, {
          policy,
          pinned,
          capBytes: settings.settings.opfsCacheCapBytes,
        });
      } catch (error) {
        if (attempt !== this.attempt) return;
        this.error = playbackErrorText(error);
        this.state = "error";
        setPlaybackWakeLockActive(false);
        if (error instanceof UnavailableTrackError) await this.skipUnavailable(this.error);
      }
    },
    async skipUnavailable(error: string): Promise<void> {
      if (!this.current || this.skippedAttempt === this.attempt) return;
      this.skippedAttempt = this.attempt;
      this.diagnostics.unshift({ trackId: this.current.id, title: this.current.title ?? "Untitled",
        artist: this.current.artist ?? "", error, at: Date.now(), skipped: true });
      this.diagnostics.splice(50);
      const next = useQueueStore().next();
      if (next) await this.play(next);
      else { this.state = "error"; this.error = error; setPlaybackWakeLockActive(false); }
    },
    pause(): void {
      this.ensure().pause();
      setPlaybackWakeLockActive(false);
    },
    resume(): void {
      this.ensure().resume();
      setPlaybackWakeLockActive(true);
    },
    async toggle(): Promise<void> {
      if (!this.current) return;
      if (this.state === "playing") {
        this.pause();
      } else if (this.state === "paused") {
        this.resume();
      } else if (this.state === "ended" || this.state === "error") {
        await this.play(this.current);
      }
    },
    stop(): void {
      this.attempt++;
      this.ensure().stop();
      setPlaybackWakeLockActive(false);
      this.current = null;
      this.position = 0;
    },
    async seek(seconds: number): Promise<void> {
      await this.ensure().seek(seconds);
      this.position = seconds;
    },
    setVolume(volume: number): void {
      this.volume = Math.max(0, Math.min(1, volume));
      this.ensure().setVolume(this.volume);
    },
    updateReplayGain(): void {
      if (!this.current) return;
      const settings = useSettingsStore().settings;
      this.ensure().setParams({ gainDb: computeGainDb(this.current, settings.replayGainMode, settings.replayGainPreampDb) });
    },
    async refreshOutput(): Promise<void> { await this.ensure().refreshOutput?.(true); },
    async togglePinCurrent(): Promise<void> {
      if (!this.current || this.moqEnabled) return;
      const settings = useSettingsStore();
      const id = this.current.id;
      const next = !this.pinned[String(id)];
      this.pinned[String(id)] = next;
      if (next) {
        const entry = await getCacheEntry(id);
        if (entry) {
          await pinCachedTrack(id, true);
        } else {
          await cacheTrack(this.current, {
            policy: "pin-only",
            pinned: true,
            capBytes: settings.settings.opfsCacheCapBytes,
          });
        }
      } else {
        await pinCachedTrack(id, false);
      }
    },
    setParams(p: {
      pitchSemi?: number;
      tempoPct?: number;
      speedPct?: number;
      gainDb?: number;
    }): void {
      this.ensure().setParams(p);
    },
    async onEnded(): Promise<void> {
      const finished = this.current;
      if (finished) {
        void api.post("/api/history", {
          trackId: finished.id,
          playedToCompletion: true,
        });
      }
      const queue = useQueueStore();
      const next = queue.next();
      if (next) await this.play(next);
    },
    async loadPinState(trackId: number): Promise<boolean> {
      let pinned = false;
      try {
        const entry = await getCacheEntry(trackId);
        pinned = !!entry?.pinned;
      } catch {
        pinned = false;
      }
      this.pinned[String(trackId)] = pinned;
      return pinned;
    },
    async cachePolicyFor(sourceId: number): Promise<CachePolicy> {
      const sources = useSourcesStore();
      if (!sources.loaded) {
        try {
          await sources.load();
        } catch {
          return "none";
        }
      }
      return sources.sources.find((s) => s.id === sourceId)?.cachePolicy ?? "none";
    },
  },
});

function setPlaybackWakeLockActive(active: boolean): void {
  if (playbackWakeLock === undefined) {
    playbackWakeLock = createPlaybackWakeLockController();
  }
  playbackWakeLock?.setActive(active);
}

export function installPlayerBackendForTest(backend: PlayerBackend): () => void {
  const previousPlayer = player;
  const previousFactory = createPlayerBackend;
  player = null;
  createPlayerBackend = () => backend;
  return () => {
    player = previousPlayer;
    createPlayerBackend = previousFactory;
  };
}

export function installPlaybackWakeLockForTest(
  controller: PlaybackWakeLockController | null
): () => void {
  const previousWakeLock = playbackWakeLock;
  const previousFactory = createPlaybackWakeLockController;
  playbackWakeLock = controller;
  createPlaybackWakeLockController = () => controller;
  return () => {
    playbackWakeLock = previousWakeLock;
    createPlaybackWakeLockController = previousFactory;
  };
}
