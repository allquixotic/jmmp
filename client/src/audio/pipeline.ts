// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { CachePolicy, Track } from "@jmmp/shared";
import { UnavailableTrackError, playbackErrorText } from "./playback-error";
import { SoundTouchNode } from "./soundtouch-node";
import { requestPlaybackAudioSession } from "./audio-session";
import { createDecoder, type DecodedChunk, type StreamingDecoder } from "./decoders";
import { planSeek } from "./seek";
import { evictLruIfOver, getCachedFile, storeStream } from "src/storage/opfs-cache";
import { shouldCacheAudio } from "./cache-policy";
import { cloneChannels, sliceDecodedChunk } from "./pcm-slices";

export type PlayerState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export interface PlayerEvents {
  state: PlayerState;
  position: number; // seconds
  duration: number; // seconds, may be 0 if unknown
  error: string;
}

const CHUNK = 64 * 1024;
const MAX_WORKLET_BUFFER_FRAMES = 4 * 48_000;
const PCM_PUSH_FRAMES = 16 * 1024;
const DEFAULT_CACHE_CAP_BYTES = 2 * 1024 * 1024 * 1024;

export interface PlaybackCacheOptions {
  policy: CachePolicy;
  pinned: boolean;
  capBytes: number;
}

interface Playback {
  abort: AbortController;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  decoder?: StreamingDecoder;
  pcmFramesPushed: number;
}

export class AudioPlayer extends EventTarget {
  private audioContext: AudioContext | null = null;
  private soundTouch: SoundTouchNode | null = null;
  private gain: GainNode | null = null;
  private playback: Playback | null = null;
  state: PlayerState = "idle";
  currentTrack: Track | null = null;
  duration = 0;
  private params = { pitchSemi: 0, tempoPct: 0, speedPct: 0, gainDb: 0 };
  private volume = 1;
  private cacheOptions: PlaybackCacheOptions = {
    policy: "none",
    pinned: false,
    capBytes: DEFAULT_CACHE_CAP_BYTES,
  };
  private offsetAtStart = 0;
  private contextTimeAtStart = 0;
  private positionInterval: ReturnType<typeof setInterval> | null = null;
  private playbackGeneration = 0;
  private foregroundListening = false;
  private readonly recoverForegroundAudio = () => {
    const ctx = this.audioContext;
    if (document.visibilityState !== "visible" || !ctx || !["playing", "loading"].includes(this.state) || ctx.state === "running" || ctx.state === "closed") return;
    requestPlaybackAudioSession();
    void ctx.resume().catch(error => this.dispatchEvent(new CustomEvent("error", { detail: playbackErrorText(error) })));
  };

  async ensureContext(): Promise<void> {
    requestPlaybackAudioSession();
    if (!this.foregroundListening && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.recoverForegroundAudio); this.foregroundListening = true;
    }
    if (this.audioContext) return;
    this.audioContext = new AudioContext({ latencyHint: "interactive" });
    this.soundTouch = await SoundTouchNode.create(this.audioContext);
    this.gain = this.audioContext.createGain();
    this.gain.gain.value = this.volume;
    this.soundTouch.node.connect(this.gain).connect(this.audioContext.destination);
    this.soundTouch.setParams(this.params);
  }

  setParams(partial: Partial<typeof this.params>): void {
    Object.assign(this.params, partial);
    this.soundTouch?.setParams(this.params);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  async play(track: Track, cacheOptions?: Partial<PlaybackCacheOptions>): Promise<void> {
    await this.ensureContext();
    this.currentTrack = track;
    this.duration = track.durationMs / 1000;
    this.dispatchPosition(0);
    this.cacheOptions = { ...this.cacheOptions, ...cacheOptions };
    await this.startPlayback(track, 0);
  }

  async seek(seconds: number): Promise<void> {
    const track = this.currentTrack;
    if (!track) return;
    await this.ensureContext();
    const wasPaused = this.state === "paused";
    await this.startPlayback(track, seconds);
    if (wasPaused) this.pause();
  }

  private async startPlayback(track: Track, targetSeconds: number): Promise<void> {
    const generation = ++this.playbackGeneration;
    this.stopPlayback(false, false);
    this.setState("loading");
    const ctx = this.audioContext!;
    const soundTouch = this.soundTouch!;
    if (ctx.state !== "running") { requestPlaybackAudioSession(); await ctx.resume(); }
    await soundTouch.resetAndWait();
    if (generation !== this.playbackGeneration) return;

    const decoder = await createDecoder(track.codec);
    if (generation !== this.playbackGeneration) {
      await decoder.destroy().catch(() => {});
      return;
    }
    const seek = planSeek(track, targetSeconds);
    const stream = await openStreamForTrack(track, seek.startByte, this.cacheOptions).catch(async error => {
      await decoder.destroy().catch(() => {}); throw error;
    });
    if (generation !== this.playbackGeneration) {
      await decoder.destroy().catch(() => {});
      await stream.cancel().catch(() => {});
      return;
    }
    const reader = stream.getReader();
    const abort = new AbortController();

    const playback: Playback = {
      abort,
      reader,
      decoder,
      pcmFramesPushed: 0,
    };
    this.playback = playback;

    let configured = false;
    let discardSeconds = seek.discardSeconds;
    const pushDecodedChunk = async (chunk: DecodedChunk): Promise<boolean> => {
      if (abort.signal.aborted || this.playback !== playback) return false;
      if (!configured) {
        soundTouch.configure(chunk.sampleRate, chunk.channels.length);
        configured = true;
      }
      for (const slice of sliceDecodedChunk(chunk, PCM_PUSH_FRAMES)) {
        await soundTouch.waitForBufferedBelow(
          MAX_WORKLET_BUFFER_FRAMES - PCM_PUSH_FRAMES,
          abort.signal
        );
        if (abort.signal.aborted || this.playback !== playback) return false;
        soundTouch.pushPcm(cloneChannels(slice.channels));
        playback.pcmFramesPushed += slice.samplesDecoded;
      }
      return true;
    };

    this.setState("playing");
    this.offsetAtStart = seek.offsetSeconds;
    this.contextTimeAtStart = ctx.currentTime;
    this.dispatchPosition(seek.offsetSeconds);
    this.startPositionTicker();

    void (async () => {
      try {
        while (!abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const decoded = await decoder.decode(value);
          for (const chunk of decoded) {
            const trimmed = trimDecodedChunk(chunk, discardSeconds);
            if (!trimmed) {
              discardSeconds -= chunk.samplesDecoded / chunk.sampleRate;
              continue;
            }
            discardSeconds = 0;
            if (!(await pushDecodedChunk(trimmed))) return;
          }
        }
        for (const chunk of await decoder.flush()) {
          if (abort.signal.aborted || this.playback !== playback) return;
          if (!(await pushDecodedChunk(chunk))) return;
        }
        soundTouch.end();
        await soundTouch.waitDrained(abort.signal);
        if (!abort.signal.aborted && this.playback === playback) this.setState("ended");
      } catch (err) {
        if (abort.signal.aborted || this.playback !== playback) return;
        const message = playbackErrorText(err);
        this.dispatchEvent(new CustomEvent("error", { detail: message }));
        this.setState("error");
      } finally {
        await decoder.destroy().catch(() => {});
        if (this.playback === playback) this.stopPositionTicker();
      }
    })();
  }

  pause(): void {
    if (!this.audioContext || this.state !== "playing") return;
    void this.audioContext.suspend();
    this.setState("paused");
  }

  resume(): void {
    if (!this.audioContext || this.state !== "paused") return;
    requestPlaybackAudioSession();
    void this.audioContext.resume();
    this.setState("playing");
  }

  stop(): void {
    if (this.foregroundListening) { document.removeEventListener("visibilitychange", this.recoverForegroundAudio); this.foregroundListening = false; }
    this.stopPlayback();
    this.currentTrack = null;
    this.duration = 0;
    this.dispatchPosition(0);
    this.setState("idle");
  }

  private stopPlayback(reset = true, invalidate = true): void {
    if (invalidate) this.playbackGeneration++;
    this.playback?.abort.abort();
    void this.playback?.reader?.cancel().catch(() => {});
    if (reset) this.soundTouch?.reset();
    this.playback = null;
    this.stopPositionTicker();
  }

  private setState(s: PlayerState): void {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new CustomEvent("state", { detail: s }));
  }

  private startPositionTicker(): void {
    this.stopPositionTicker();
    this.positionInterval = setInterval(() => {
      if (!this.audioContext) return;
      const elapsed = this.audioContext.currentTime - this.contextTimeAtStart;
      const tempoFactor = 1 + this.params.tempoPct / 100;
      const rateFactor = 1 + this.params.speedPct / 100;
      const playedSec =
        elapsed * tempoFactor * rateFactor + this.offsetAtStart;
      const position = this.duration > 0 ? Math.min(playedSec, this.duration) : playedSec;
      this.dispatchPosition(position);
    }, 250);
  }

  private dispatchPosition(position: number): void {
    this.dispatchEvent(
      new CustomEvent("position", { detail: { position, duration: this.duration } })
    );
  }

  private stopPositionTicker(): void {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }
}

function trimDecodedChunk(chunk: DecodedChunk, discardSeconds: number): DecodedChunk | null {
  if (discardSeconds <= 0) return chunk;
  const discardFrames = Math.min(
    chunk.samplesDecoded,
    Math.floor(discardSeconds * chunk.sampleRate)
  );
  if (discardFrames >= chunk.samplesDecoded) return null;
  return {
    ...chunk,
    samplesDecoded: chunk.samplesDecoded - discardFrames,
    channels: chunk.channels.map((c) => c.subarray(discardFrames)),
  };
}

async function openStreamForTrack(
  track: Track,
  startByte = 0,
  cacheOptions?: PlaybackCacheOptions
): Promise<ReadableStream<Uint8Array>> {
  if (track.serverAvailable === false) throw new Error("Import this local track to the jmmp server before playback");

  const cached = await getCachedFile(track.id, track.fileSize);
  if (cached) return cached.slice(startByte).stream();

  if (!navigator.onLine) throw new Error("Track is not cached for offline playback");

  const headers: Record<string, string> = {};
  if (startByte > 0) headers.Range = `bytes=${startByte}-`;
  const resp = await fetch(`/api/stream/${track.id}`, { credentials: "include", headers });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null) as { code?: string; error?: string } | null;
    if (body?.code === "spotify_unavailable") throw new UnavailableTrackError(body.error ?? "Spotify track unavailable", body.error);
    throw new Error(body?.error ?? `Stream request failed: HTTP ${resp.status}`);
  }
  if (!resp.body) throw new Error("Stream response has no body");
  return maybeCacheStream(track, resp.body, startByte, cacheOptions);
}

function maybeCacheStream(
  track: Track,
  stream: ReadableStream<Uint8Array>,
  startByte: number,
  cacheOptions?: PlaybackCacheOptions
): ReadableStream<Uint8Array> {
  if (
    startByte > 0 ||
    !cacheOptions ||
    !shouldCacheAudio(cacheOptions.policy, cacheOptions.pinned)
  ) {
    return stream;
  }
  const [playbackStream, cacheStream] = stream.tee();
  void storeStream(track.id, cacheStream, {
    pinned: cacheOptions.pinned,
    ...(track.fileSize !== undefined ? { expectedBytes: track.fileSize } : {}),
  })
    .then(() => evictLruIfOver(cacheOptions.capBytes))
    .catch((err) => console.warn("failed to cache stream", err));
  return playbackStream;
}

export async function cacheTrack(
  track: Track,
  cacheOptions: PlaybackCacheOptions
): Promise<void> {
  const stream = await openStreamForTrack(track, 0, {
    ...cacheOptions,
    pinned: true,
  });
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

// Convenience reader for chunking small Uint8Array windows from a stream
// (kept for future use by tests/seek).
export async function* readChunked(
  stream: ReadableStream<Uint8Array>,
  chunkSize = CHUNK
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (!pending.length) {
      pending = value;
    } else {
      const combined: Uint8Array = new Uint8Array(pending.length + value.length);
      combined.set(pending, 0);
      combined.set(value, pending.length);
      pending = combined;
    }
    while (pending.length >= chunkSize) {
      yield pending.subarray(0, chunkSize);
      pending = pending.subarray(chunkSize);
    }
  }
  if (pending && pending.length) yield pending;
}
