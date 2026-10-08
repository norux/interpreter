import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioChunk, InterpretationEvent, MediaTargetId, SpeechRecognizer, TextTranslator, TranscriptRevision } from "../packages/contracts";
import { createRevisionStore } from "../packages/core/revision-store";
import { createBrowserPipeline } from "../packages/engines-browser/pipeline";

const identity = { sessionId: "pipeline-test", targetId: "selected" as MediaTargetId, epoch: 0 };
const languages = { source: "ja", target: "ko" };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function source(index = 1): TranscriptRevision {
  return { identity, utteranceId: `speech-${index}`, sourceRevision: 1, final: true,
    language: "ja", text: "synthetic source", audioRange: { startMs: (index - 1) * 1000, endMs: index * 1000 } };
}
async function* audio(): AsyncIterable<AudioChunk> {
  for (let sequence = 0; sequence < 3; sequence++) {
    const pcm = new Float32Array(1600).fill(0.2);
    const startMs = sequence * 100 / 3; const endMs = (sequence + 1) * 100 / 3;
    yield { identity, scope: "selected-video", sequence, sampleRate: 48000, channels: 1, sampleFormat: "pcm-f32le",
      audioRange: { startMs, endMs }, capture: { clockId: "input-clock", startMs: 300 + startMs, endMs: 300 + endMs }, pcm: pcm.buffer };
  }
}
// These fakes exercise real normalization, revision routing and lifecycle, not ASR accuracy.
function fixture(count = 1, stale = false) {
  const calls: { result: ReturnType<typeof deferred<string>>; source: TranscriptRevision }[] = [];
  let cancelled = 0; let closed = 0; let translatorClosed = 0;
  let normalizedSamples = 0;
  const recognizer: SpeechRecognizer = {
    async *run(input) {
      for await (const chunk of input) { assert.equal(chunk.sampleRate, 16000); normalizedSamples += chunk.pcm.byteLength / 4; }
      for (let i = 1; i <= count; i++) yield stale ? { ...source(i), identity: { ...identity, epoch: 2 } } : source(i);
    }, async cancel() { cancelled++; }, async close() { closed++; },
  };
  const translator: TextTranslator = {
    async *translate(source, languages) {
      const result = deferred<string>(); calls.push({ result, source });
      yield { identity: source.identity, utteranceId: source.utteranceId, sourceRevision: source.sourceRevision,
        translationRevision: calls.length, languages, final: source.final, text: await result.promise };
    }, async cancel() {}, async close() { translatorClosed++; },
  };
  const pipeline = createBrowserPipeline(identity, languages, receive => {
    // Frequent queue telemetry is coalesced without suppressing caption events.
    for (let i = 0; i < 100; i++) receive({ identity, state: "running", message: "running", queue: { pendingAudioMs: i, droppedAudioMs: 0 } });
    return recognizer;
  }, translator);
  return { pipeline, calls, counts: () => ({ cancelled, closed, translatorClosed, normalizedSamples }) };
}

test("pipeline publishes original-first events accepted by core and drains translations after audio EOF", async () => {
  const f = fixture(2); const iterator = f.pipeline.run(audio())[Symbol.asyncIterator]();
  let result = await iterator.next();
  if (result.value?.type === "status") result = await iterator.next();
  assert.equal(result.value?.type, "transcript");
  const store = createRevisionStore(identity, 300);
  const pending = store.accept(result.value as InterpretationEvent, { startMs: 2000, endMs: 3000 });
  assert.equal(pending?.translation.state, "pending", "Pending originals must be transcript events; an unpaired paired-caption is rejected by core");
  result = await iterator.next(); assert.equal(result.value?.type, "transcript"); store.accept(result.value as InterpretationEvent);
  const translated = iterator.next(); let ended = false; void translated.then(() => { ended = true; });
  await tick(); assert.equal(ended, false, "EOF does not drop accepted native translation work");
  assert.equal(f.calls.length, 1);
  f.calls[0].result.resolve("합성 번역 1");
  result = await translated; assert.equal(result.value?.type, "translation");
  const paired = store.accept(result.value as InterpretationEvent);
  assert.equal(paired?.translation.state, "paired"); assert.deepEqual(paired?.videoRange, { startMs: 2000, endMs: 3000 });
  await tick(); assert.equal(f.calls.length, 2); f.calls[1].result.resolve("합성 번역 2");
  result = await iterator.next(); assert.equal(result.value?.type, "translation"); store.accept(result.value as InterpretationEvent);
  assert.equal((await iterator.next()).done, true);
  assert.equal(store.snapshot().length, 2); assert.ok(store.snapshot().every(caption => caption.translation.state === "paired"));
  await f.pipeline.close(); assert.deepEqual(f.counts(), { cancelled: 1, closed: 1, translatorClosed: 0, normalizedSamples: 1600 });
});

test("pipeline cancellation invalidates synchronously and suppresses late translations", async () => {
  const f = fixture(); const iterator = f.pipeline.run(audio())[Symbol.asyncIterator]();
  let result = await iterator.next(); if (result.value?.type === "status") result = await iterator.next();
  assert.equal(result.value?.type, "transcript");
  const waiting = iterator.next(); await tick();
  await f.pipeline.cancel({ ...identity, epoch: 99 });
  let settled = false; void waiting.then(() => { settled = true; }); await tick(); assert.equal(settled, false);
  await f.pipeline.cancel(identity); assert.equal((await waiting).done, true);
  f.calls[0].result.resolve("late"); await tick(); assert.equal((await iterator.next()).done, true);
  await f.pipeline.close(); await f.pipeline.close(); assert.equal(f.counts().cancelled, 1);
});

test("pipeline rejects stale source identities and exposes final-queue overload", async () => {
  const stale = fixture(1, true);
  await assert.rejects(async () => { for await (const _ of stale.pipeline.run(audio())) {} }, /engine-failed/);
  assert.equal(stale.calls.length, 0); await stale.pipeline.close();
  const overloaded = fixture(5);
  await assert.rejects(async () => { for await (const _ of overloaded.pipeline.run(audio())) {} }, /overloaded/);
  assert.equal(overloaded.calls.length, 1);
  overloaded.calls[0].result.resolve("late"); await overloaded.pipeline.close();
});

test("pipeline exposes GPU loss through the engine status contract before ending", async () => {
  const failures: InterpretationEvent[] = [];
  const translator: TextTranslator = { async *translate() {}, async cancel() {}, async close() {} };
  const recognizer: SpeechRecognizer = { async *run() { yield await Promise.reject<TranscriptRevision>(new Error("gpu-lost")); }, async cancel() {}, async close() {} };
  const pipeline = createBrowserPipeline(identity, languages, () => recognizer, translator);
  await assert.rejects(async () => { for await (const event of pipeline.run(audio())) failures.push(event); }, /gpu-lost/);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0], { type: "status", status: { identity, state: "failed", reason: "gpu-lost", message: "gpu-lost" } });
  await pipeline.close();
});
