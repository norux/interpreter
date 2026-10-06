import assert from "node:assert/strict";
import { test } from "node:test";
import type { MediaTargetId } from "../packages/contracts";
import { createAsrHost } from "../packages/engines-browser/asr-host";
import { type AsrJob, validAsrJob } from "../packages/engines-browser/asr-protocol";

const job = (): AsrJob => ({ identity: { sessionId: "asr-unit", targetId: "video" as MediaTargetId, epoch: 2 }, utteranceId: "one",
  audioRange: { startMs: 1000, endMs: 2000 }, language: "ja", pcm: new Float32Array(16000) });

test("ASR transport rejects malformed, oversized, nonfinite and mistimed PCM", () => {
  assert.equal(validAsrJob(job()), true);
  for (const invalid of [null, {}, { ...job(), language: "ko" }, { ...job(), identity: { ...job().identity, epoch: -1 } },
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
    messages: { requestId: number; type: string; job?: AsrJob }[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message: { requestId: number; type: string; job?: AsrJob }, transfers: ArrayBuffer[]) {
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
    const preparation = host.prepare(); const worker = workers[0];
    worker.reply({ type: "ready" }); await preparation;
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
    host.dispose(); host.dispose(); await assert.rejects(host.prepare(), /visible secure document/);
  } finally {
    host.dispose();
    if (original) Object.defineProperty(globalThis, "Worker", original); else Reflect.deleteProperty(globalThis, "Worker");
  }
});
