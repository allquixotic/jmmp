// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { AudioDsp } from "@jmmp/shared/audio/dsp";
import { createDecoder, type DecodedChunk } from "@jmmp/shared/audio/decoders";
import type { Codec, DspParams } from "@jmmp/shared";
import { loadAdapter } from "../sources/index.ts";
import { loadOrInitMachineKey } from "../crypto.ts";

const RATE = 48000, QUANTUM = 960;
let generation = 0, paused = false, params: DspParams;
let cancelled: (() => void) | undefined;
let ack: (() => void) | undefined;
let dsp: AudioDsp | undefined;
function applyParams() {
  dsp?.handle({ type: "params", pitch: params.pitchSemi, tempo: params.tempoPct,
    rate: params.speedPct, gainDb: params.gainDb });
}
self.onmessage = e => {
  const m = e.data;
  if (m.type === "ack") { ack?.(); ack = undefined; return; }
  if (m.type === "stop" || m.type === "start") {
    generation = m.generation; cancelled?.(); ack?.(); ack = undefined;
    if (m.type === "stop") return;
    paused = !!m.paused; params = m.params;
    void play(m).catch(error => { if (m.generation === generation) self.postMessage({ type: "error", generation, error: error instanceof Error ? error.stack ?? error.message : String(error) }); });
  } else if (m.type === "params") { params = m.params; applyParams(); }
  else if (m.type === "pause") paused = m.paused;
};

async function play(m: { generation: number; dataDir: string; trackId: number; position: number }) {
  const mine = m.generation;
  const db = new Database(join(m.dataDir, "jmmp.sqlite"), { readonly: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  cancelled = () => { void reader?.cancel().catch(() => {}); };
  const decoderHolder: { decoder?: Awaited<ReturnType<typeof createDecoder>> } = {};
  try {
    const track = db.query<{ source_id: number; source_track_id: string; codec: Codec; duration_ms: number }, [number]>("SELECT source_id, source_track_id, codec, duration_ms FROM tracks WHERE id = ?").get(m.trackId);
    if (!track) throw new Error("Track not found");
    const key = await loadOrInitMachineKey(m.dataDir);
    const source = await loadAdapter(db, key, track.source_id, m.dataDir);
    if (!source) throw new Error("Source is unavailable on the server");
    const upstream = await source.adapter.fetch(track.source_track_id);
    if (upstream.status < 200 || upstream.status >= 300) { await upstream.body.cancel(); throw new Error(`Source returned HTTP ${upstream.status}`); }
    reader = upstream.body.getReader();
    if (mine !== generation) return;
    const decoder = decoderHolder.decoder = await createDecoder(track.codec);
    const engine = new AudioDsp(RATE); dsp = engine; applyParams();
    let sourceRate = 0, eof = false, skip = m.position, position = m.position;
    const chunks: DecodedChunk[] = [];
    let chunkOffset = 0, bytes: Uint8Array | undefined, byteOffset = 0;
    const left = new Float32Array(QUANTUM), right = new Float32Array(QUANTUM);
    let next = performance.now(), lastStatus = 0;
    // Decode from byte zero on seek: reliable for every supported container,
    // bounded memory, and still exactly one upstream reader.
    while (mine === generation) {
      if (paused) { await Bun.sleep(20); next = performance.now(); continue; }
      while (engine.bufferedFrames() < RATE / 2 && (!eof || chunks.length > 0) && mine === generation) {
        if (chunks.length) {
          const c = chunks[0]!;
          if (sourceRate !== c.sampleRate) {
            if (!Number.isFinite(c.sampleRate) || c.sampleRate <= 0 || !c.channels.length) throw new Error("Unsupported source sample rate/channel layout");
            // Match the browser DSP: mono is duplicated; extra channels are ignored.
            sourceRate = c.sampleRate; engine.handle({ type: "config", sampleRate: sourceRate, channels: Math.min(c.channels.length, 2) });
          }
          const discard = Math.min(c.samplesDecoded - chunkOffset, Math.ceil(skip * sourceRate));
          chunkOffset += discard; skip = Math.max(0, skip - discard / sourceRate);
          const take = Math.min(8192, c.samplesDecoded - chunkOffset);
          if (take > 0) engine.handle({ type: "pcm", channels: c.channels.slice(0, 2).map(ch => ch.subarray(chunkOffset, chunkOffset + take)) });
          chunkOffset += take;
          if (chunkOffset >= c.samplesDecoded) { chunks.shift(); chunkOffset = 0; }
          continue;
        }
        if (eof) break;
        if (!bytes || byteOffset === bytes.length) {
          const result = await reader.read();
          if (mine !== generation) return;
          if (result.done) { chunks.push(...await decoder.flush()); eof = true; break; }
          bytes = result.value; byteOffset = 0;
        }
        const end = Math.min(bytes.length, byteOffset + 4096);
        chunks.push(...await decoder.decode(bytes.subarray(byteOffset, end))); byteOffset = end;
      }
      if (eof && !chunks.length) engine.handle({ type: "end" });
      if (mine !== generation) break;
      const got = engine.process([left, right]);
      if (engine.drained) { self.postMessage({ type: "ended", generation: mine, position }); break; }
      if (!got) { await Bun.sleep(5); continue; }
      const wait = next - performance.now(); if (wait > 0) await Bun.sleep(wait);
      if (mine !== generation) break;
      const pcm = new Float32Array(QUANTUM * 2);
      for (let i = 0; i < QUANTUM; i++) { pcm[i * 2] = left[i]! * params.volume; pcm[i * 2 + 1] = right[i]! * params.volume; }
      const acknowledged = new Promise<void>(resolve => { ack = resolve; });
      self.postMessage({ type: "pcm", generation: mine, pcm }, [pcm.buffer]);
      await acknowledged; // One frame in flight; pipe backpressure bounds memory.
      position += got / RATE * (1 + params.tempoPct / 100) * (1 + params.speedPct / 100);
      next = Math.max(next + QUANTUM / RATE * 1000, performance.now() - 100);
      if (performance.now() - lastStatus > 200) {
        self.postMessage({ type: "position", generation: mine, position, duration: track.duration_ms / 1000 }); lastStatus = performance.now();
      }
    }
  } finally {
    await reader?.cancel().catch(() => {});
    await decoderHolder.decoder?.destroy(); db.close();
    if (mine === generation) { dsp = undefined; cancelled = undefined; }
  }
}
