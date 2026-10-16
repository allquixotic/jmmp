// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { DEFAULT_DSP_PARAMS } from "@jmmp/shared";
import { initDb } from "../db.ts";
import { encryptJson, loadOrInitMachineKey } from "../crypto.ts";
import type { PipelineDiagnostic } from "../audio/diagnostics.ts";

test("V24/V27 packaged Spotify worker produces PCM and preserves useful source error stacks", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "jmmp-packaged-worker-"));
  const native = join(dataDir, "native", "fixture");
  await mkdir(native, { recursive: true });
  const workerPath = join(native, "audio-worker.js"), helperPath = join(native, "jmmp-moq");
  const db = initDb(dataDir);
  let worker: Worker | undefined;
  try {
    const fixture = Buffer.from(await Bun.file(join(import.meta.dir, "fixtures/tone.flac")).arrayBuffer()).toString("base64");
    const slowFixture = Buffer.from(await Bun.file(join(import.meta.dir, "fixtures/continuity-one.flac")).arrayBuffer()).toString("base64");
    // Exercise the real Spotify adapter/pipe and shared DSP. This stand-in only
    // replaces Spotify networking; its bytes are decoded with the fixture codec.
    await Bun.write(helperPath, `#!${process.execPath}\nconst reader = Bun.stdin.stream().getReader();
const request = JSON.parse(await reader.read().then(r => new TextDecoder().decode(r.value).split('\\n')[0]));
await reader.cancel();
if (request.operation !== 'stream') process.exit(1);
if (request.uri === 'spotify:track:6sWHDYs0csV6RS48xBl0tH') {
  console.log(JSON.stringify({kind:'error',code:'unavailable',message:'private-credential'}));process.exit(1);
}
if (request.uri === 'spotify:track:8sWHDYs0csV6RS48xBl0tH') {
  console.log(JSON.stringify({status:200,size:100,start:0,end:99}));
  console.error(JSON.stringify({event:'diagnostic',stage:'source_server',phase:'source_read',eventType:'failed',reason:'timeout',attempt:3}));
  process.exit(1);
}
const slow = request.uri === 'spotify:track:7sWHDYs0csV6RS48xBl0tH';
const bytes = Buffer.from(slow ? ${JSON.stringify(slowFixture)} : ${JSON.stringify(fixture)}, 'base64');
const header = Buffer.from(JSON.stringify({status:200,size:bytes.length,start:0,end:bytes.length-1})+'\\n');
if (slow) {
  const writer = Bun.stdout.writer(); writer.write(header); await writer.flush();
  await Bun.sleep(1200); writer.write(bytes.subarray(0,32768)); await writer.flush();
  await Bun.sleep(3000); writer.write(bytes.subarray(32768)); await writer.flush(); await writer.end();
} else await Bun.write(Bun.stdout, Buffer.concat([header, bytes]));\n`);
    await chmod(helperPath, 0o700);
    await build({ entryPoints: [join(import.meta.dir, "../audio/worker.ts")], outfile: workerPath,
      bundle: true, platform: "node", target: "es2023", format: "esm", external: ["bun:sqlite"],
      minify: false, keepNames: true, treeShaking: false });
    const key = await loadOrInitMachineKey(dataDir);
    const credentials = await encryptJson(key, { kind: "spotify", accessToken: "fixture-token", refreshToken: "", expiresAt: Date.now() + 3600000 });
    db.run("INSERT INTO sources (kind,name,config_json,creds_encrypted,cache_policy) VALUES ('spotify','Fixture',?,?,'none')", [JSON.stringify({kind:"spotify",clientId:"a".repeat(32),uris:[]}), credentials]);
    db.run("INSERT INTO tracks(source_id,source_track_id,title,codec,duration_ms) VALUES (1,'spotify:track:5sWHDYs0csV6RS48xBl0tH','Fixture','flac',1000)");
    db.run("INSERT INTO tracks(source_id,source_track_id,title,codec,duration_ms) VALUES (1,'spotify:track:6sWHDYs0csV6RS48xBl0tH','Unavailable','flac',1000)");
    db.run("INSERT INTO tracks(source_id,source_track_id,title,codec,duration_ms) VALUES (1,'spotify:track:7sWHDYs0csV6RS48xBl0tH','Delayed source','flac',12000)");
    db.run("INSERT INTO tracks(source_id,source_track_id,title,codec,duration_ms) VALUES (1,'spotify:track:8sWHDYs0csV6RS48xBl0tH','Timed out source','flac',12000)");
    let frames = 0, peak = 0;
    let timer: ReturnType<typeof setTimeout>;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Bundled worker did not finish playback")), 8000);
        worker = new Worker(workerPath);
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessage = event => {
          const message = event.data;
          if (message.type === "error") reject(new Error(message.error));
          if (message.type === "ended") resolve();
          if (message.type === "pcm") {
            frames += message.pcm.length / 2;
            for (const value of message.pcm as Float32Array) peak = Math.max(peak, Math.abs(value));
            worker!.postMessage({type:"ack"});
          }
        };
        worker.postMessage({type:"start",dataDir,trackId:1,generation:1,position:0,paused:false,params:{...DEFAULT_DSP_PARAMS,volume:.5}});
      });
    } finally { clearTimeout(timer!); }
    expect(frames).toBeGreaterThan(40000);
    expect(peak).toBeGreaterThan(.0001);
    expect(peak).toBeLessThanOrEqual(.5);
    const failure = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Bundled worker did not report source failure")), 8000);
      worker!.onmessage = event => {
        if (event.data.type === "error" && event.data.generation === 2) { clearTimeout(timeout); expect(event.data.errorCode).toBe("spotify_unavailable"); resolve(event.data.error); }
      };
      worker!.postMessage({type:"start",dataDir,trackId:2,generation:2,position:0,paused:false,params:DEFAULT_DSP_PARAMS});
    });
    expect(failure).toContain("SpotifySourceError: Spotify track is unavailable");
    expect(failure).toContain("audio-worker.js:");
    expect(failure).not.toContain("private-credential");
    const diagnostics: PipelineDiagnostic[] = [];
    await new Promise<void>((resolve, reject) => {
      let first = true;
      const timeout = setTimeout(() => reject(Error("Worker did not diagnose/recover the delayed source")), 8000);
      worker!.onmessage = event => {
        const message = event.data;
        if (message.type === "error") { clearTimeout(timeout); reject(Error(message.error)); }
        if (message.type === "diagnostic") {
          diagnostics.push(message.diagnostic);
          if (message.diagnostic.event === "recovered" && message.diagnostic.startup !== true && message.diagnostic.phase === "source_read" &&
              diagnostics.some(d => d.stage === "source_server" && d.phase === "source_read" && d.startup !== true && d.event === "gap")) {
            clearTimeout(timeout); resolve();
          }
        }
        if (message.type === "pcm") {
          // Real worker acknowledgement backpressure must be reported while pending.
          if (first) { first = false; setTimeout(() => worker?.postMessage({ type: "ack" }), 250); }
          else worker!.postMessage({ type: "ack" });
        }
      };
      worker!.postMessage({type:"start",dataDir,trackId:3,generation:3,position:0,paused:false,params:DEFAULT_DSP_PARAMS});
    });
    expect(diagnostics.some(d => d.stage === "server_helper" && d.phase === "pipe_ack" && d.event === "gap")).toBe(true);
    expect(diagnostics.some(d => d.stage === "source_server" && d.phase === "source_read" && d.event === "gap" && Number(d.gapMs) > 100)).toBe(true);
    expect(diagnostics.some(d => d.phase === "source_read" && d.startup === true && d.event === "gap")).toBe(true);
    expect(diagnostics.every(d => d.generation === 3 && d.trackId === 3 && d.sourceId === 1)).toBe(true);
    const interrupted = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker did not report the download timeout")), 4000);
      worker!.onmessage = event => {
        if (event.data.type === "error" && event.data.generation === 4) {
          clearTimeout(timeout); expect(event.data.errorCode).toBeUndefined(); resolve(event.data.error);
        }
        if (event.data.type === "pcm") worker!.postMessage({type:"ack"});
      };
      worker!.postMessage({type:"start",dataDir,trackId:4,generation:4,position:0,paused:false,params:DEFAULT_DSP_PARAMS});
    });
    expect(interrupted).toContain("Spotify audio download failed");
    expect(interrupted).toContain("timeout; 3 recovery attempts");
    expect(interrupted).toContain("audio-worker.js:");
  } finally {
    worker?.terminate(); db.close();
    await rm(dataDir, {recursive:true,force:true});
  }
}, 20000);
