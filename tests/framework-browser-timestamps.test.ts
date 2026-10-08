import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { LogitsProcessor, LogitsProcessorList, Tensor } from "@huggingface/transformers";
import { transformWithOxc } from "vite";
import { validAsrJob } from "../packages/engines-browser/asr-protocol";
import { asrCandidates } from "../packages/engines-browser/model";

// Execute the unexported worker with fake preparation/inference, but real SDK
// logits/tensors. These checks establish decoding rules, not ASR accuracy.
async function recognitionOptions(candidate: keyof typeof asrCandidates, samples = 16000) {
  let options: { logits_processor?: LogitsProcessorList; return_timestamps?: boolean } | undefined;
  const pipeline = Object.assign(async (_pcm: Float32Array, value: typeof options) => {
    options = value;
    return { text: "synthetic result" };
  }, { model: { generation_config: { no_timestamps_token_id: 20 } } });
  const replies: { type: string }[] = [];
  const scope = {
    env: { backends: { onnx: {} } }, LogitsProcessor, LogitsProcessorList, Tensor,
    asrCandidates, validAsrJob, Float32Array, ArrayBuffer, performance, console,
    loadAsrPipeline: async () => pipeline,
    createModelRepository: (load: () => Promise<unknown>) => ({
      async *prepare() { await load(); yield { state: "ready" }; },
    }),
    postMessage: (message: { type: string }) => replies.push(message),
    onmessage: undefined as ((event: { data: unknown }) => Promise<void>) | undefined,
  };
  const path = "packages/engines-browser/asr-worker.ts";
  const compiled = (await transformWithOxc(await readFile(path, "utf8"), path, { target: "es2022" })).code;
  runInNewContext(compiled.replace(/^import[\s\S]*?;\n/gm, ""), scope);
  assert.ok(scope.onmessage);
  await scope.onmessage({ data: { version: 1, requestId: 1, type: "prepare", candidate, device: "webgpu" } });
  assert.equal(replies.at(-1)?.type, "ready");
  await scope.onmessage({ data: { version: 1, requestId: 2, type: "recognize", job: {
    identity: { sessionId: "timestamp-unit", targetId: "selected", epoch: 0 }, utteranceId: "one",
    audioRange: { startMs: 0, endMs: samples / 16 }, language: "ja", pcm: new Float32Array(samples),
  } } });
  assert.equal(replies.at(-1)?.type, "result");
  assert.ok(options);
  return options;
}

for (const candidate of ["smallFp16", "turboFp16", "smallTimestamped"] as const) {
  test(`${candidate} timestamp decoding rejects backwards and zero-length segments without banning repeated speech`, async () => {
    const options = await recognitionOptions(candidate);
    assert.equal(options.return_timestamps, true);
    assert.ok(options.logits_processor, "Timestamped inference must constrain monotonic segment positions");
    // Timestamp IDs start at 21. The end at 26 and following start at 26
    // may be equal; an end after text must be strictly greater than its start.
    const inputs = [[1n, 2n, 3n], [1n, 2n, 3n, 23n, 5n],
      [1n, 2n, 3n, 23n, 5n, 26n], [1n, 2n, 3n, 23n, 5n, 26n, 26n, 5n]];
    const logits = new Tensor("float32", new Float32Array(4 * 32).fill(1), [4, 32]);
    const output = options.logits_processor(inputs, logits) as Tensor;
    assert.equal(output, logits);
    for (let row = 0; row < 4; row++) {
      const scores = (output.data as Float32Array).subarray(row * 32, (row + 1) * 32);
      assert.equal(scores[5], 1, "Text tokens, including repetitions, stay available");
      assert.equal(scores[4], 1, "EOS stays available");
      const firstAllowed = [21, 24, 26, 27][row];
      for (let token = 21; token < 32; token++) assert.equal(scores[token], token < firstAllowed ? -Infinity : 1);
    }
    const fresh = new Tensor("float32", new Float32Array(32).fill(1), [1, 32]);
    options.logits_processor([[1n, 2n, 3n, 21n, 5n]], fresh);
    assert.equal(fresh.data[22], 1, "Another sequence starts independently of earlier calls/rows");
  });
}

test("q8 baseline keeps non-timestamp decoding", async () => {
  for (const candidate of ["tiny", "base", "small"] as const) {
    const options = await recognitionOptions(candidate);
    assert.equal(options.return_timestamps, false);
    assert.equal(options.logits_processor, undefined);
  }
});

for (const candidate of ["smallFp16", "turboFp16", "smallTimestamped"] as const) {
  test(`${candidate} timestamps cannot enter padded audio beyond the final PCM tick`, async () => {
    for (const samples of [1600, 16000, 16016, 16000 * 30]) {
      const options = await recognitionOptions(candidate, samples);
      assert.ok(options.logits_processor);
      // Each Whisper timestamp tick covers 320 samples at 16 kHz. Round up
      // only the fractional final tick; do not permit the 30-second padding.
      const lastAllowed = 21 + Math.ceil(samples / 320);
      const width = 1523;
      const logits = new Tensor("float32", new Float32Array(2 * width).fill(1), [2, width]);
      options.logits_processor([[1n, 2n, 3n], [1n, 2n, 3n, 21n, 5n]], logits);
      for (let row = 0; row < 2; row++) {
        const scores = (logits.data as Float32Array).subarray(row * width, (row + 1) * width);
        assert.equal(scores[lastAllowed], 1, "The final covering tick stays available");
        assert.equal(scores[lastAllowed + 1], -Infinity, "Padding is not audio");
        assert.ok(scores.subarray(lastAllowed + 1).every(score => score === -Infinity), "All later ticks stay unavailable");
        assert.equal(scores[5], 1, "Repeated text is never suppressed by the duration bound");
        assert.equal(scores[4], 1, "EOS stays available");
      }
    }
  });
}
