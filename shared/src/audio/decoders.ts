// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Codec } from "../codec.ts";

export interface DecodedChunk {
  channels: Float32Array[];
  sampleRate: number;
  samplesDecoded: number;
}

export interface StreamingDecoder {
  decode(chunk: Uint8Array): Promise<DecodedChunk[]>;
  flush(): Promise<DecodedChunk[]>;
  reset(): Promise<void>;
  destroy(): Promise<void>;
}

interface WaaCommon {
  decode(buf: Uint8Array): Promise<{
    channelData?: Float32Array[];
    channels?: Float32Array[];
    sampleRate: number;
    samplesDecoded: number;
  }>;
  flush?(): Promise<{
    channelData?: Float32Array[];
    channels?: Float32Array[];
    sampleRate: number;
    samplesDecoded: number;
  }>;
  reset?(): Promise<void>;
  free?(): void;
  ready?: Promise<void>;
}

function toChunk(out: Awaited<ReturnType<WaaCommon["decode"]>>): DecodedChunk {
  const channels =
    (out.channelData as Float32Array[] | undefined) ??
    (out.channels as Float32Array[] | undefined) ??
    [];
  return {
    channels,
    sampleRate: out.sampleRate,
    samplesDecoded: out.samplesDecoded ?? channels[0]?.length ?? 0,
  };
}

export async function createDecoder(codec: Codec): Promise<StreamingDecoder> {
  switch (codec) {
    case "mp3": {
      const { MPEGDecoder } = await import("mpg123-decoder");
      const dec = new MPEGDecoder() as unknown as WaaCommon;
      await dec.ready;
      return wrap(dec);
    }
    case "flac": {
      const mod = await import("@wasm-audio-decoders/flac");
      const FLACDecoder = (mod as unknown as { FLACDecoder: new () => WaaCommon }).FLACDecoder;
      const dec = new FLACDecoder();
      await dec.ready;
      return wrap(dec);
    }
    case "vorbis": {
      const mod = await import("@wasm-audio-decoders/ogg-vorbis");
      const OggVorbisDecoder = (mod as unknown as {
        OggVorbisDecoder: new () => WaaCommon;
      }).OggVorbisDecoder;
      const dec = new OggVorbisDecoder();
      await dec.ready;
      return wrap(dec);
    }
    case "opus": {
      const mod = await import("ogg-opus-decoder");
      const OggOpusDecoder = (mod as unknown as {
        OggOpusDecoder: new () => WaaCommon;
      }).OggOpusDecoder;
      const dec = new OggOpusDecoder();
      await dec.ready;
      return wrap(dec);
    }
  }
}

function wrap(dec: WaaCommon): StreamingDecoder {
  return {
    async decode(chunk: Uint8Array): Promise<DecodedChunk[]> {
      const out = await dec.decode(chunk);
      const c = toChunk(out);
      return c.samplesDecoded > 0 ? [c] : [];
    },
    async flush(): Promise<DecodedChunk[]> {
      if (!dec.flush) return [];
      const out = await dec.flush();
      const c = toChunk(out);
      return c.samplesDecoded > 0 ? [c] : [];
    },
    async reset(): Promise<void> {
      if (dec.reset) await dec.reset();
    },
    async destroy(): Promise<void> {
      if (dec.free) dec.free();
    },
  };
}
