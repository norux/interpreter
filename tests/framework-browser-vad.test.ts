import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelStatus } from "../packages/contracts";
import { registeredCandidate, vadCandidate } from "../packages/engines-browser/model";
import { createVadHost } from "../packages/engines-browser/vad-host";

// Fake transport only; learned probabilities and transcription are evaluated
// separately in the actual browser worker/ASR noise harness.
test("VAD host preserves ASR PCM, bounds frames and pending work, invalidates Stop and suspension", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    messages: { requestId: number; type: string; pcm?: Float32Array }[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message: { requestId: number; type: string; pcm?: Float32Array }, transfers: ArrayBuffer[]) {
      this.messages.push(structuredClone(message, { transfer: transfers }));
    }
    terminate() { this.terminated = true; }
    reply(value: object) { this.onmessage?.({ data: { version: 1, requestId: this.messages.at(-1)?.requestId, ...value } }); }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  const window = Object.assign(new EventTarget(), { isSecureContext: true, navigator: { userActivation: { isActive: false } } });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible", defaultView: window });
  const statuses: ModelStatus[] = [];
  const host = createVadHost(document as unknown as Document, status => statuses.push(status));
  try {
    await assert.rejects(host.prepare(), /Press Prepare/); assert.equal(workers.length, 0);
    window.navigator.userActivation.isActive = true;
    const preparation = host.prepare(); const worker = workers[0];
    await assert.rejects(host.prepare(), /overloaded/);
    const selected = registeredCandidate(vadCandidate.model, "fp32");
    worker.reply({ type: "status", status: { model: selected.model, state: "loading", requiredBytes: selected.requiredBytes } });
    worker.reply({ type: "ready" }); await preparation;
    assert.equal(statuses.at(-1)?.state, "loading");
    for (const pcm of [new Float32Array(0), new Float32Array(513), new Float32Array(512).fill(NaN),
      new Float32Array(512).fill(1.01), new Float32Array(new SharedArrayBuffer(2048))]) await assert.rejects(host.detect(pcm), /Invalid VAD/);
    const pcm = new Float32Array(512).fill(0.02); const expected = pcm.slice();
    const detection = host.detect(pcm);
    assert.deepEqual(pcm, expected, "VAD transfers its copy, retaining original ASR samples");
    assert.deepEqual(worker.messages.at(-1)?.pcm, expected);
    await assert.rejects(host.detect(pcm), /overloaded/);
    worker.reply({ type: "result", probability: 0.8, inferenceMs: 1, samples: 512, paddingSamples: 0 });
    assert.deepEqual(await detection, { probability: 0.8, inferenceMs: 1, samples: 512, paddingSamples: 0, speech: true });
    const stopped = host.detect(pcm); host.stop(); await assert.rejects(stopped, /VAD stopped/);
    assert.equal(worker.terminated, true);
    const restart = host.prepare(); const replacement = workers[1]; replacement.reply({ type: "ready" }); await restart;
    worker.reply({ type: "error", reason: "late failure" });
    const short = host.detect(new Float32Array(23));
    replacement.reply({ type: "result", probability: 0.1, inferenceMs: 1, samples: 23, paddingSamples: 489 });
    assert.equal((await short).paddingSamples, 489);
    await assert.rejects(host.detect(pcm), /Invalid VAD/);
    host.stop(); const again = host.prepare(); workers[2].reply({ type: "ready" }); await again;
    const suspended = host.detect(pcm);
    document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
    await assert.rejects(suspended, /VAD stopped/); assert.equal(workers[2].terminated, true);
    await assert.rejects(host.prepare(), /visible secure document/);
    document.visibilityState = "visible"; const last = host.prepare(); workers[3].reply({ type: "ready" }); await last;
    const invalid = host.detect(pcm);
    workers[3].reply({ type: "result", probability: 2, inferenceMs: 1, samples: 512, paddingSamples: 0 });
    await assert.rejects(invalid, /Invalid VAD worker response/);
    assert.equal(workers[3].terminated, true);
    host.dispose(); host.dispose(); await assert.rejects(host.prepare(), /visible secure document/);
  } finally {
    host.dispose();
    if (original) Object.defineProperty(globalThis, "Worker", original); else Reflect.deleteProperty(globalThis, "Worker");
  }
});
