// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { AudioDsp } from "@jmmp/shared/audio/dsp";
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
class SoundTouchProcessor extends AudioWorkletProcessor {
  private dsp = new AudioDsp(sampleRate, message => this.port.postMessage(message));
  constructor() {
    super();
    this.port.onmessage = e => this.dsp.handle(e.data);
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.dsp.process(outputs[0]!);
    return true;
  }
}
registerProcessor("soundtouch-processor", SoundTouchProcessor);
