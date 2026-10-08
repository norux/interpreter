import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transformWithOxc } from "vite";

test("replay trace preserves decoder arguments/output and never carries an earlier job's trace", async () => {
  const sequences = [{ tokens: [1n, 21n, 5n, 24n], stride: [1, 0, 0] }];
  const options = { time_precision: 0.02, return_timestamps: true };
  const output = ["unchanged", { chunks: [{ text: "unchanged", timestamp: [0, 0.06] }] }];
  const sent: { type: string; decodeTrace?: unknown }[] = [];
  let decoded = 0;
  class Tokenizer {
    timestamp_begin = 21;
    decode(tokens: bigint[], settings: { skip_special_tokens: boolean }) {
      assert.deepEqual(tokens, [1n, 5n]);
      assert.equal(settings.skip_special_tokens, true);
      return "raw text";
    }
    _decode_asr(input: typeof sequences, settings: typeof options) {
      assert.equal(input, sequences); assert.equal(settings, options);
      decoded++; return output;
    }
  }
  const scope = { WhisperTokenizer: Tokenizer, postMessage: (message: typeof sent[number]) => sent.push(message) };
  const path = "tests/fixtures/browser-asr-trace-worker.ts";
  const compiled = (await transformWithOxc(await readFile(path, "utf8"), path, { target: "es2022" })).code;
  runInNewContext(compiled.replace(/^import.*;\n/gm, ""), scope);
  const tokenizer = new Tokenizer();
  assert.equal(tokenizer._decode_asr(sequences, options), output);
  assert.equal(decoded, 1, "The original decoder is invoked exactly once");
  const status = { type: "status" };
  scope.postMessage(status); assert.equal(sent[0], status);
  const result = { type: "result", text: "unchanged", requestId: 2 };
  scope.postMessage(result);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1])), { ...result, decodeTrace: {
    timestampBegin: 21, timePrecision: 0.02,
    inputs: [{ tokens: [1, 21, 5, 24], stride: [1, 0, 0], rawText: "raw text" }],
    decodedText: output[0], decoded: output[1],
  } });
  assert.ok(!("decodeTrace" in result), "The original result is not mutated");
  assert.deepEqual(sequences, [{ tokens: [1n, 21n, 5n, 24n], stride: [1, 0, 0] }]);
  scope.postMessage({ type: "result" }); assert.equal(sent.at(-1)?.decodeTrace, undefined);
  tokenizer._decode_asr(sequences, options);
  const error = { type: "error" };
  scope.postMessage(error); assert.equal(sent.at(-1), error);
  scope.postMessage({ type: "result" }); assert.equal(sent.at(-1)?.decodeTrace, undefined);
});
