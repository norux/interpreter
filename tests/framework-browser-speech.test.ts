import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioChunk, MediaTargetId, SessionStatus } from "../packages/contracts";
import type { AsrJob } from "../packages/engines-browser/asr-protocol";
import { createSpeechRecognizer } from "../packages/engines-browser/speech-recognizer";

const identity = { sessionId: "speech-unit", targetId: "video" as MediaTargetId, epoch: 2 };
function chunk(sequence: number, speech = true, samples = 1600): AudioChunk {
  const startMs = sequence * samples / 16;
  return { identity, scope: "selected-video", sequence, audioRange: { startMs, endMs: startMs + samples / 16 },
    capture: { clockId: "fixture", startMs: 9000 + startMs, endMs: 9000 + startMs + samples / 16 },
    sampleRate: 16000, channels: 1, sampleFormat: "pcm-f32le", pcm: new Float32Array(samples).fill(speech ? 0.05 : 0).buffer };
}
async function* source(chunks: AudioChunk[]) { yield* chunks; }
async function collect<T>(stream: AsyncIterable<T>) { const results: T[] = []; for await (const value of stream) results.push(value); return results; }
function setup() {
  const jobs: AsrJob[] = []; const statuses: SessionStatus[] = []; let stops = 0;
  const recognizer = createSpeechRecognizer(identity, "ja", {
    async recognize(job) {
      jobs.push(structuredClone(job));
      return { revision: { ...job, pcm: undefined, sourceRevision: 1, final: true, text: "fake transport result" }, inferenceMs: 1 };
    },
    stop() { stops++; },
  }, status => statuses.push(status));
  return { recognizer, jobs, statuses, get stops() { return stops; } };
}

// Segmentation/lifecycle tests use a fake executor; accuracy is measured in the
// separate real Chromium streaming harness, never inferred from these strings.
test("speech port preserves arbitrary chunk frames, ranges and silence endpoints", async () => {
  const fixture = setup();
  const samples = 701;
  const chunks = Array.from({ length: 30 }, (_, i) => chunk(i, i >= 3 && i < 19, samples));
  const results = await collect(fixture.recognizer.run(source(chunks)));
  assert.equal(results.length, 1); assert.equal(fixture.jobs.length, 1);
  const job = fixture.jobs[0];
  assert.deepEqual(job.identity, identity); assert.equal(job.language, "ja"); assert.equal(job.utteranceId, "speech-1");
  assert.equal(job.audioRange.startMs, 120); // frame containing first active sample
  assert.equal(job.pcm.length, 19110); // until EOF: last silence is under 500 ms
  assert.equal(job.audioRange.endMs, 1314.375);
  assert.equal(job.pcm[182], 0); assert.ok(job.pcm[183] > 0);
  assert.equal(fixture.statuses.at(-1)?.queue?.pendingAudioMs, 0);
  assert.equal(fixture.statuses.at(-1)?.queue?.droppedAudioMs, 0);
  assert.equal(fixture.stops, 1);
  await assert.rejects(collect(fixture.recognizer.run(source([]))), /fresh session/);

  const silent = setup();
  assert.deepEqual(await collect(silent.recognizer.run(source([chunk(0, false), chunk(1, false)]))), []);
  assert.equal(silent.jobs.length, 0);
});

test("gap, duplicate, epoch and clock changes discard context without joining audio", async () => {
  for (const replacement of [chunk(2), chunk(0), { ...chunk(1), identity: { ...identity, epoch: 3 } },
    { ...chunk(1), audioRange: { startMs: 101, endMs: 201 } },
    { ...chunk(1), capture: { clockId: "another-clock", startMs: 9100, endMs: 9200 } }]) {
    const fixture = setup();
    await assert.rejects(collect(fixture.recognizer.run(source([chunk(0), replacement]))), /audio-gap/);
    assert.equal(fixture.jobs.length, 0); assert.equal(fixture.stops, 1);
    assert.equal(fixture.statuses.at(-1)?.reason, "audio-gap");
    assert.equal(fixture.statuses.at(-1)?.queue?.droppedAudioMs, 100);
    assert.equal(fixture.statuses.at(-1)?.queue?.pendingAudioMs, 0);
  }
});

test("speech boundary rejects tab mixes, non-normalized, oversized and nonfinite input", async () => {
  for (const invalid of [{ ...chunk(0), scope: "tab-mix" as const }, { ...chunk(0), sampleRate: 24000 },
    { ...chunk(0), channels: 2 }, { ...chunk(0), pcm: new Float32Array(1600).fill(Number.NaN).buffer },
    { ...chunk(0), pcm: new Float32Array(1600).fill(1.01).buffer },
    { ...chunk(0), pcm: new SharedArrayBuffer(6400) as unknown as ArrayBuffer }, chunk(0, true, 3201)]) {
    const fixture = setup();
    await assert.rejects(collect(fixture.recognizer.run(source([invalid]))), /engine-failed/);
    assert.equal(fixture.jobs.length, 0);
  }
});

test("continuous input reserves queue headroom and stays within the 30 second model bound", async () => {
  const fixture = setup();
  const results = await collect(fixture.recognizer.run(source(Array.from({ length: 310 }, (_, i) => chunk(i)))));
  assert.equal(results.length, 2);
  assert.deepEqual(fixture.jobs.map(job => job.audioRange), [{ startMs: 0, endMs: 20000 }, { startMs: 20000, endMs: 31000 }]);
  assert.deepEqual(fixture.jobs.map(job => job.pcm.length), [320000, 176000]);
  assert.ok(fixture.statuses.every(status => (status.queue?.pendingAudioMs ?? 0) <= 30000));
});

test("long speech uses a speech-band pause without deleting carrier or speech samples", async () => {
  const fixture = setup();
  const chunks = Array.from({ length: 150 }, (_, sequence) => {
    const packet = chunk(sequence);
    const pcm = new Float32Array(packet.pcm);
    for (let i = 0; i < pcm.length; i++) {
      const sample = sequence * pcm.length + i;
      const voice = sequence >= 110 && sequence < 113 ? 0 : 0.05 * Math.sin(2 * Math.PI * 1000 * sample / 16000);
      const carrier = sequence === 112 ? 0 : 0.06 * Math.sin(2 * Math.PI * 6500 * sample / 16000);
      pcm[i] = voice + carrier;
    }
    return packet;
  });
  await collect(fixture.recognizer.run(source(chunks)));
  assert.equal(fixture.jobs.length, 2);
  assert.deepEqual(fixture.jobs.map(job => job.audioRange), [{ startMs: 0, endMs: 11200 }, { startMs: 11200, endMs: 15000 }]);
  const supplied = new Float32Array(chunks.length * 1600);
  chunks.forEach((packet, i) => { supplied.set(new Float32Array(packet.pcm), i * 1600); });
  const recognized = new Float32Array(supplied.length);
  recognized.set(fixture.jobs[0].pcm); recognized.set(fixture.jobs[1].pcm, fixture.jobs[0].pcm.length);
  assert.deepEqual(recognized, supplied);
  assert.equal(fixture.statuses.at(-1)?.queue?.pendingAudioMs, 0);
  assert.equal(fixture.statuses.at(-1)?.queue?.droppedAudioMs, 0);
});

test("continuous input still reports loss when inference exhausts the retained audio budget", async () => {
  const statuses: SessionStatus[] = []; const jobs: AsrJob[] = [];
  let resolveJob: (value: never) => void = () => {}; let stops = 0;
  const recognizer = createSpeechRecognizer(identity, "ja", {
    recognize(job) { jobs.push(job); return new Promise(resolve => { resolveJob = resolve; }); },
    stop() { stops++; },
  }, status => statuses.push(status));
  // Headroom is bounded: stalled inference still fails visibly without joining
  // surviving audio or reviving a late result.
  await assert.rejects(collect(recognizer.run(source(Array.from({ length: 301 }, (_, i) => chunk(i))))), /overloaded/);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].pcm.length, 320000);
  assert.deepEqual(jobs[0].audioRange, { startMs: 0, endMs: 20000 });
  assert.equal(stops, 1); assert.equal(statuses.at(-1)?.reason, "overloaded");
  assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 30100);
  assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
  assert.ok(statuses.every(status => (status.queue?.pendingAudioMs ?? 0) <= 30000));
  const before = statuses.length;
  resolveJob({ revision: { ...jobs[0], sourceRevision: 1, final: true, text: "late" }, inferenceMs: 100 } as never);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(statuses.length, before);
});

test("bounded pending work fails visibly and cancels a stalled job, rejecting its late result", async () => {
  const statuses: SessionStatus[] = []; const jobs: AsrJob[] = []; let resolveJob: (value: never) => void = () => {};
  let stops = 0;
  const recognizer = createSpeechRecognizer(identity, "en", {
    recognize(job) { jobs.push(job); return new Promise(resolve => { resolveJob = resolve; }); },
    stop() { stops++; },
  }, status => statuses.push(status));
  // Four 100 ms bursts, separated by exactly 500 ms silence: one active plus
  // two pending utterances are retained; the fourth cannot be admitted.
  const chunks = Array.from({ length: 24 }, (_, i) => chunk(i, i % 6 === 0));
  await assert.rejects(collect(recognizer.run(source(chunks))), /overloaded/);
  assert.equal(jobs.length, 1); assert.equal(stops, 1);
  assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 2400);
  assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
  const before = statuses.length;
  resolveJob({ revision: { ...jobs[0], sourceRevision: 1, final: true, text: "late" }, inferenceMs: 10 } as never);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(statuses.length, before);
});

test("cancel releases pending input immediately and ignores unrelated session cancellation", async () => {
  const fixture = setup(); let returned = 0;
  const stream = { [Symbol.asyncIterator]() { return {
    next: () => new Promise<IteratorResult<AudioChunk>>(() => {}),
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  const result = fixture.recognizer.run(stream)[Symbol.asyncIterator]().next();
  await fixture.recognizer.cancel({ ...identity, epoch: 1 }); assert.equal(fixture.stops, 0);
  await fixture.recognizer.cancel(identity);
  await assert.rejects(result, /cancelled/);
  await fixture.recognizer.close(); await fixture.recognizer.close();
  assert.equal(fixture.stops, 1); assert.equal(returned, 1);
});

test("upstream normalization gaps remain audio-gap status and discard ASR context", async () => {
  const fixture = setup();
  async function* interrupted() { yield chunk(0); throw new Error("audio-gap"); }
  await assert.rejects(collect(fixture.recognizer.run(interrupted())), /audio-gap/);
  assert.equal(fixture.jobs.length, 0); assert.equal(fixture.stops, 1);
  assert.equal(fixture.statuses.at(-1)?.reason, "audio-gap");
  assert.equal(fixture.statuses.at(-1)?.queue?.droppedAudioMs, 100);
});

test("learned speech admission rejects energetic noise without submitting ASR or losing audio", async () => {
  const fixture = setup();
  let frames = 0; let detectorStops = 0;
  const detector = { async detect(pcm: Float32Array) { frames++; assert.ok(pcm.length <= 512); return { speech: false }; },
    stop() { detectorStops++; } };
  const jobs: AsrJob[] = [];
  const recognizer = createSpeechRecognizer(identity, "en", {
    async recognize(job: AsrJob) { jobs.push(job); throw new Error("Noise must not reach ASR"); }, stop() {},
  }, (status: SessionStatus) => fixture.statuses.push(status), detector);
  await collect(recognizer.run(source(Array.from({ length: 60 }, (_, i) => chunk(i)))));
  assert.equal(jobs.length, 0); assert.equal(frames, 188); assert.equal(detectorStops, 1);
  assert.equal(fixture.statuses.at(-1)?.queue?.droppedAudioMs, 0);
  assert.equal(fixture.statuses.at(-1)?.queue?.pendingAudioMs, 0);
});

test("learned admission keeps every energetic input sample and cancels an outstanding detector", async () => {
  const jobs: AsrJob[] = []; const frames: Float32Array[] = [];
  const supplied = Array.from({ length: 210 }, (_, i) => chunk(i));
  const recognizer = createSpeechRecognizer(identity, "en", {
    async recognize(job) { jobs.push(structuredClone(job)); return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 }; }, stop() {},
  }, () => {}, { async detect(pcm) { frames.push(pcm); return { speech: true }; }, stop() {} });
  await collect(recognizer.run(source(supplied)));
  assert.deepEqual(jobs.map(job => job.audioRange), [{ startMs: 0, endMs: 20000 }, { startMs: 20000, endMs: 21000 }]);
  const expected = new Float32Array(336000).fill(0.05);
  const submitted = new Float32Array(336000); submitted.set(jobs[0].pcm); submitted.set(jobs[1].pcm, 320000);
  assert.deepEqual(submitted, expected); assert.equal(frames.at(-1)?.length, 128);
  let release: (value: { speech: boolean }) => void = () => {}; let detectorStops = 0; let asrCalls = 0;
  const statuses: SessionStatus[] = [];
  const cancelled = createSpeechRecognizer(identity, "en", {
    async recognize() { asrCalls++; throw new Error("Unexpected ASR"); }, stop() {},
  }, status => statuses.push(status), { detect() { return new Promise(resolve => { release = resolve; }); }, stop() { detectorStops++; } });
  const run = collect(cancelled.run(source([chunk(0)])));
  await new Promise<void>(resolve => setImmediate(resolve));
  await cancelled.cancel(identity); await assert.rejects(run, /cancelled/);
  const count = statuses.length; release({ speech: true });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(statuses.length, count); assert.equal(detectorStops, 1); assert.equal(asrCalls, 0);
  assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 100);
});
