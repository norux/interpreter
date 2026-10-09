import assert from "node:assert/strict";
import { test } from "node:test";
import type { MediaTargetId } from "../packages/contracts";
import { createAsrHost } from "../packages/engines-browser/asr-host";
import { type AsrJob, validAsrJob } from "../packages/engines-browser/asr-protocol";

const job = (): AsrJob => ({ identity: { sessionId: "asr-unit", targetId: "video" as MediaTargetId, epoch: 2 }, utteranceId: "one",
  audioRange: { startMs: 1000, endMs: 2000 }, language: "ja", pcm: new Float32Array(16000) });

test("ASR transport rejects malformed, oversized, nonfinite and mistimed PCM", () => {
  assert.equal(validAsrJob(job()), true);
  for (const invalid of [null, {}, { ...job(), language: "fr" }, { ...job(), identity: { ...job().identity, epoch: -1 } },
    { ...job(), pcm: new Float32Array(16000 * 30 + 1) }, { ...job(), pcm: new Float32Array(1599) },
    { ...job(), pcm: new Float32Array(16000).fill(Number.NaN) }, { ...job(), pcm: new Float32Array(16000).fill(1.01) },
    { ...job(), audioRange: { startMs: 1000, endMs: 2100 } }, { ...job(), pcm: new Int16Array(16000) },
    { ...job(), pcm: new Float32Array(16000 * 31).subarray(0, 16000) },
    { ...job(), pcm: new Float32Array(new SharedArrayBuffer(64000)) }]) assert.equal(validAsrJob(invalid), false);
});

// Fake transport tests only. Real recognition, timing, memory and GPU loss are
// measured independently by framework-chrome-asr.mjs.
test("ASR host bounds jobs, rejects late results and keeps GPU loss explicit", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    onmessageerror?: () => void;
    messages: { requestId: number; type: string; candidate?: string; job?: AsrJob }[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message: { requestId: number; type: string; candidate?: string; job?: AsrJob }, transfers: ArrayBuffer[]) {
      this.messages.push(structuredClone(message, { transfer: transfers }));
    }
    terminate() { this.terminated = true; }
    reply(value: object) { this.onmessage?.({ data: { version: 1, requestId: this.messages.at(-1)?.requestId, ...value } }); }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  const documentEvents = new EventTarget(); const windowEvents = new EventTarget();
  const document = Object.assign(documentEvents, { visibilityState: "visible", defaultView: Object.assign(windowEvents,
    { isSecureContext: true, navigator: { userActivation: { isActive: false } } }) }) as unknown as Document;
  const host = createAsrHost(document, "tiny", "webgpu", () => {});
  try {
    await assert.rejects(host.prepare(), /Press Prepare/); assert.equal(workers.length, 0);
    (document.defaultView?.navigator.userActivation as { isActive: boolean }).isActive = true;
    for (const candidate of ["smallFp16", "turboFp16"] as const) {
      const unsupported = createAsrHost(document, candidate, "wasm", () => {});
      try {
        await assert.rejects(unsupported.prepare(), /FP16 candidate requires WebGPU/);
        assert.equal(workers.length, 0, "Unsupported precision/backend must not start a worker or fall back");
      } finally { unsupported.dispose(); }
    }
    const preparation = host.prepare(); const worker = workers[0];
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(worker.terminated, false, "Preparation must continue in a hidden tab");
    worker.reply({ type: "ready" }); await preparation;
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(worker.terminated, false, "A prepared model must survive until the tab returns");
    await assert.rejects(host.recognize(job()), /visible secure document/);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    const input = job(); const originalIdentity = { ...input.identity };
    const recognition = host.recognize(input);
    assert.equal(input.pcm.byteLength, 0, "PCM ownership transfers to the worker");
    const extra = job(); await assert.rejects(host.recognize(extra), /overloaded/);
    assert.equal(extra.pcm.byteLength, 64000, "Rejected overload must retain caller PCM");
    (input.identity as { epoch: number }).epoch = 9;
    worker.reply({ type: "result", text: "synthetic result", inferenceMs: 12 });
    assert.deepEqual((await recognition).revision.identity, originalIdentity);
    const stopped = host.recognize(job()); host.stop();
    await assert.rejects(stopped, /ASR stopped/); assert.equal(worker.terminated, true);
    worker.reply({ type: "result", text: "late result", inferenceMs: 1 });
    await assert.rejects(host.recognize(job()), /not ready/);
    const restart = host.prepare(); const current = workers[1]; current.reply({ type: "ready" }); await restart;
    worker.reply({ type: "gpu-lost" }); // An old worker cannot invalidate the replacement.
    const preserved = host.recognize(job()); void preserved.catch(() => {});
    assert.equal(current.messages.at(-1)?.type, "recognize", "Replacement must remain ready after old worker loss");
    current.reply({ type: "result", text: "current result", inferenceMs: 1 }); await preserved;
    const lost = host.recognize(job()); current.reply({ type: "gpu-lost" });
    await assert.rejects(lost, /gpu-lost/);
    await assert.rejects(host.recognize(job()), /gpu-lost/); assert.equal(current.terminated, true);
    const visible = host.prepare(); const resumed = workers.at(-1); resumed?.reply({ type: "ready" }); await visible;
    const hidden = host.recognize(job());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assert.rejects(hidden, /ASR stopped/); assert.equal(resumed?.terminated, true);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const closing = host.prepare(); const closedWorker = workers.at(-1);
    document.defaultView?.dispatchEvent(new Event("pagehide"));
    await assert.rejects(closing, /ASR stopped/); assert.equal(closedWorker?.terminated, true);
    host.dispose(); host.dispose(); await assert.rejects(host.prepare(), /visible secure document/);
    const turbo = createAsrHost(document, "turboFp16", "webgpu", () => {});
    try {
      const preparing = turbo.prepare(); const current = workers.at(-1);
      assert.equal(current?.messages.at(-1)?.candidate, "turboFp16", "Explicit candidate must cross the worker boundary");
      current?.reply({ type: "status", status: { state: "ready", model: { id: "onnx-community/whisper-small", version: "36050c46d777d46dc4b5f43f6d90574fc38f8732" }, requiredBytes: 487960440 } });
      await assert.rejects(preparing, /Invalid ASR worker response/);
      assert.equal(current?.terminated, true, "Another candidate's readiness must fail without fallback");
    } finally { turbo.dispose(); }
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    (document.defaultView?.navigator.userActivation as { isActive: boolean }).isActive = false;
    const background = createAsrHost(document, "turboFp16", "webgpu", () => {}, "offscreen");
    try {
      const prepared = background.prepare(); const current = workers.at(-1);
      current?.reply({ type: "ready" }); await prepared;
      const recognition = background.recognize(job());
      document.dispatchEvent(new Event("visibilitychange"));
      assert.equal(current?.terminated, false, "Offscreen inference survives hidden document events");
      current?.reply({ type: "result", text: "background result", inferenceMs: 1 });
      assert.equal((await recognition).revision.text, "background result");
      const timed = background.recognize({ ...job(), timestamps: true });
      current?.reply({ type: "result", text: "Timed sentence.", inferenceMs: 1,
        segments: [{ text: "Timed sentence.", startMs: 0, endMs: 900 }] });
      assert.deepEqual((await timed).segments,
        [{ text: "Timed sentence.", startMs: 0, endMs: 900 }]);

      const automatic = background.recognize({ ...job(), language: "auto" });
      current?.reply({ type: "result", text: "한국어 발화", language: "ko", languageConfidence: 0.91, inferenceMs: 1 });
      const detected = await automatic;
      assert.equal(detected.revision.language, "ko");
      assert.deepEqual(detected.revision.confidence, { measure: "whisper-language-probability", value: 0.91 });
      for (const detection of [{}, { language: "fr", languageConfidence: 0.9 }, { language: "en", languageConfidence: NaN },
        { language: "ja", languageConfidence: 1.1 }]) {
        const invalid = background.recognize({ ...job(), language: "auto" });
        workers.at(-1)?.reply({ type: "result", text: "Invalid detection", inferenceMs: 1, ...detection });
        await assert.rejects(invalid, /Invalid ASR language detection/);
        const prepared = background.prepare(); workers.at(-1)?.reply({ type: "ready" }); await prepared;
      }

      for (const segments of [undefined, [{ text: "Bad", startMs: -1, endMs: 900 }],
        [{ text: "Bad", startMs: 0, endMs: 1001 }], [{ text: "Bad", startMs: NaN, endMs: 900 }],
        [{ text: "Bad", startMs: 0, endMs: 600 }, { text: "Bad", startMs: 500, endMs: 900 }],
        [{ text: "Different", startMs: 0, endMs: 900 }]]) {
        const malformed = background.recognize({ ...job(), timestamps: true });
        workers.at(-1)?.reply({ type: "result", text: "Bad", inferenceMs: 1, segments });
        await assert.rejects(malformed, /Invalid ASR timestamp/);
        const restarted = background.prepare(); workers.at(-1)?.reply({ type: "ready" }); await restarted;
      }
      const cancelled = background.recognize(job()); background.stop();
      await assert.rejects(cancelled, /ASR stopped/);
      assert.equal(workers.at(-1)?.terminated, true);
    } finally { background.dispose(); }

  } finally {
    host.dispose();
    if (original) Object.defineProperty(globalThis, "Worker", original); else Reflect.deleteProperty(globalThis, "Worker");
  }
});
