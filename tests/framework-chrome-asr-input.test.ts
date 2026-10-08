import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

test("extension test observer archives exact pre-transfer PCM without changing worker calls", async () => {
  // Exercise the actual init script, including its worker wrapper. This is only
  // observation/transfer conformance; real ASR reproduction has its own browser run.
  const source = await readFile("tests/framework-chrome-extension.mjs", "utf8");
  const script = source.split("await context.addInitScript(() => {")[1]?.split("\n  });\n  await page.goto(origin)")[0];
  assert.ok(script);
  const calls: unknown[][] = [];
  const scope = {
    Worker: class {
      constructor(...args: unknown[]) { calls.push(args); }
      addEventListener() {}
      postMessage(message: unknown, transfer: Transferable[]) {
        calls.push([message, transfer]);
        structuredClone(message, { transfer });
      }
      terminate() { calls.push(["terminate"]); }
    },
    crypto: webcrypto, performance, Float32Array, archiveAsrInputs: false,
  };
  runInNewContext(script, scope);
  const observed = scope as unknown as {
    Worker: { new(...args: unknown[]): { postMessage(message: unknown, transfer: Transferable[]): void; terminate(): void } };
    archiveAsrInputs: boolean;
    asrInputs: { pcm: Float32Array; digest: Promise<ArrayBuffer>; requestId: number; workerId: number }[];
  };
  const options = { type: "module" };
  const worker = new observed.Worker("production-asr-worker.js", options);
  assert.deepEqual(calls[0], ["production-asr-worker.js", options]);
  for (const enabled of [false, true]) {
    observed.archiveAsrInputs = enabled;
    const pcm = new Float32Array([0, -0.5, 0.25, 1]);
    const expected = pcm.slice();
    const message = { type: "recognize", requestId: 7,
      job: { pcm, identity: { sessionId: "test" }, utteranceId: "speech-1", language: "ja", audioRange: { startMs: 0, endMs: 0.25 } } };
    const transfer = [pcm.buffer];
    worker.postMessage(message, transfer);
    assert.equal(calls.at(-1)?.[0], message);
    assert.equal(calls.at(-1)?.[1], transfer);
    assert.equal(pcm.byteLength, 0, "The original transferable still detaches");
    assert.equal(observed.asrInputs.length, enabled ? 1 : 0);
    if (enabled) {
      const archived = observed.asrInputs[0];
      assert.equal(archived.workerId, 1); assert.equal(archived.requestId, 7);
      assert.deepEqual(archived.pcm, expected);
      assert.equal(Buffer.from(await archived.digest).toString("hex"), createHash("sha256").update(Buffer.from(expected.buffer)).digest("hex"));
    }
  }
  worker.terminate();
  assert.deepEqual(calls.at(-1), ["terminate"], "Original cleanup still executes");
});
