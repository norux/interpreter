import assert from "node:assert/strict";
import { test } from "node:test";
import { createTabAudioSource } from "../extension/capture/tab-audio";

test("Stop while the worklet loads closes the context and never connects late nodes", async (t) => {
  let releaseModule: () => void = () => {};
  let enteredModule: () => void = () => {};
  const loading = new Promise<void>((resolve) => { enteredModule = resolve; });
  let stops = 0;
  let closes = 0;
  const track = { stop: () => { stops++; }, addEventListener() {}, removeEventListener() {} };
  class Context {
    state = "running";
    audioWorklet = {
      addModule: () => {
        enteredModule();
        return new Promise<void>((resolve) => { releaseModule = resolve; });
      },
    };
    createMediaStreamSource() { throw new Error("Late source must not be connected"); }
    async close() { this.state = "closed"; closes++; }
  }
  const properties = [
    [navigator, "mediaDevices", { getUserMedia: async () => ({ getTracks: () => [track] }) }],
    [globalThis, "AudioContext", Context],
    [globalThis, "chrome", { runtime: { getURL: (path: string) => path } }],
  ] as const;
  for (const [object, key, value] of properties) {
    const original = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(object, key, original);
      else Reflect.deleteProperty(object, key);
    });
  }
  const audio = createTabAudioSource(() => {});
  const starting = audio.start("test-stream", () => {});
  await loading;
  await audio.stop();
  releaseModule();
  await assert.rejects(starting, /stopped during startup/);
  assert.equal(stops, 1);
  assert.equal(closes, 1);
});
