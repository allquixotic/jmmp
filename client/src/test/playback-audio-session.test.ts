// Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0
import { expect, test, spyOn } from "bun:test";
import { AudioPlayer } from "../audio/pipeline";
import { SoundTouchNode } from "../audio/soundtouch-node";

test("V42 local audio requests playback before creation and foreground recovery respects pause/stop", async () => {
  const category = { type: "ambient" };
  const nav = Object.getOwnPropertyDescriptor(navigator, "audioSession");
  const audio = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  class FakeDocument extends EventTarget { visibilityState = "visible"; }
  const doc = new FakeDocument();
  class FakeContext {
    state = "running"; resumes = 0; destination = {};
    constructor() { expect(category.type).toBe("playback"); }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async resume() { this.resumes++; this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  }
  let context: FakeContext;
  Object.defineProperty(navigator, "audioSession", { configurable: true, value: category });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: class extends FakeContext {
    constructor() { super(); context = this; }
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  const worklet = Object.assign(Object.create(SoundTouchNode.prototype), {
    node: { connect: (gain: ReturnType<FakeContext["createGain"]>) => gain }, setParams() {}, reset() {},
  });
  const create = spyOn(SoundTouchNode, "create").mockResolvedValue(worklet);
  const player = new AudioPlayer();
  try {
    await player.ensureContext();
    player.state = "playing"; player.pause();
    doc.dispatchEvent(new Event("visibilitychange")); expect(context!.resumes).toBe(0);
    player.state = "playing"; context!.state = "interrupted";
    doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); expect(context!.resumes).toBe(0);
    doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); expect(context!.resumes).toBe(1);
    player.stop(); player.state = "playing"; context!.state = "interrupted";
    doc.dispatchEvent(new Event("visibilitychange")); expect(context!.resumes).toBe(1);
  } finally {
    player.stop(); create.mockRestore();
    for (const [object, key, descriptor] of [[navigator, "audioSession", nav], [globalThis, "AudioContext", audio], [globalThis, "document", documentDescriptor]] as const) {
      if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key);
    }
  }
});
