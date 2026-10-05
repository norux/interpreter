import assert from "node:assert/strict";
import { test } from "node:test";
import { createTabAudioSource } from "../extension/capture/tab-audio";

test("Stop during pending tab acquisition releases the late stream instead of starting audio", async (t) => {
  let resolveStream: (stream: MediaStream) => void = () => {};
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream;
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: () => new Promise<MediaStream>((resolve) => { resolveStream = resolve; }),
  } });
  t.after(() => {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });
  const audio = createTabAudioSource(() => {});
  const starting = audio.start("test-stream", () => {});
  await audio.stop();
  resolveStream(stream);
  await assert.rejects(starting, /stopped during startup/);
  assert.equal(stops, 1);
  await audio.stop();
  assert.equal(stops, 1);
});
