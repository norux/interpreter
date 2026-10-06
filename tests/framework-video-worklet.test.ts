import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { AudioChunk, MediaTargetId } from "../packages/contracts";
import { createTimeline } from "../packages/core/timeline";

// Processor-only regression, not real media acceptance.
for (const gap of ["missing input", "capture clock jump"]) {
  test(`worklet discards incomplete batches across ${gap} without concealing later capture gaps`, () => {
    const messages: { frame: number; pcm: ArrayBuffer }[] = [];
    let processor: { process(inputs: Float32Array[][]): boolean } | undefined;
    const scope = {
      currentFrame: 0,
      AudioWorkletProcessor: class { port = { postMessage: (data: { frame: number; pcm: ArrayBuffer }) => messages.push(data) }; },
      registerProcessor(_name: string, Constructor: new () => NonNullable<typeof processor>) { processor = new Constructor(); },
    };
    runInNewContext(readFileSync("packages/media-web/pcm-worklet.js", "utf8"), scope);
    function render(value?: number) {
      processor?.process(value === undefined ? [[]] : [[new Float32Array(128).fill(value)]]);
      scope.currentFrame += 128;
    }
    for (let i = 0; i < 4; i++) render(0.1);
    function skip() {
      if (gap === "missing input") render();
      else scope.currentFrame += 128;
    }
    skip();
    for (let i = 0; i < 16; i++) render(0.2);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].frame, 640, "The first batch starts after the gap, never stitches separated samples");
    assert.equal(new Float32Array(messages[0].pcm).every((sample) => Math.abs(sample - 0.2) < 0.00001), true);
    skip();
    for (let i = 0; i < 16; i++) render(0.3);
    const identity = { sessionId: "processor-test", targetId: "selected" as MediaTargetId, epoch: 0 };
    const timeline = createTimeline(identity);
    function chunk(index: number): AudioChunk {
      const data = messages[index];
      const startMs = (data.frame - messages[0].frame) / 48000 * 1000;
      return { identity, sequence: index, scope: "selected-video", sampleRate: 48000, channels: 1, sampleFormat: "pcm-f32le", pcm: data.pcm,
        audioRange: { startMs, endMs: startMs + 2048 / 48000 * 1000 },
        capture: { clockId: "worklet-test", startMs: data.frame / 48000 * 1000, endMs: (data.frame + 2048) / 48000 * 1000 } };
    }
    assert.equal(timeline.audio(chunk(0)), "accepted");
    assert.equal(timeline.audio(chunk(1)), "gap", "Missing input after delivery remains a real discontinuity");
  });
}
