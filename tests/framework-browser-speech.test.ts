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

test("learned pauses split energetic noise without losing inter-utterance or EOF PCM", async () => {
  const jobs: AsrJob[] = []; const statuses: SessionStatus[] = [];
  const supplied = Array.from({ length: 270 }, (_, i) => chunk(i, true, 512));
  let frame = 0;
  const recognizer = createSpeechRecognizer(identity, "ja", {
    async recognize(job) {
      jobs.push(structuredClone(job));
      return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
    }, stop() {},
  }, status => statuses.push(status), {
    async detect() {
      const index = frame++;
      return { speech: (index >= 10 && index < 80) || (index >= 100 && index < 170) || (index >= 190 && index < 260) };
    }, stop() {},
  });
  await collect(recognizer.run(source(supplied)));
  assert.deepEqual(jobs.map(job => job.audioRange), [
    { startMs: 0, endMs: 2880 }, { startMs: 2880, endMs: 5760 }, { startMs: 5760, endMs: 8640 },
  ]);
  const submitted = new Float32Array(270 * 512);
  let offset = 0;
  for (const job of jobs) { submitted.set(job.pcm, offset); offset += job.pcm.length; }
  assert.equal(offset, submitted.length);
  assert.deepEqual(submitted, new Float32Array(270 * 512).fill(0.05));
  assert.equal(frame, 270);
  assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
  assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 0);
});

test("learned pause cuts wait for sustained onset and discard isolated boundary candidates", async () => {
  for (const onsetFrames of [1, 2, 4, 5]) {
    const jobs: AsrJob[] = []; const statuses: SessionStatus[] = []; let frame = 0;
    const count = 224 + onsetFrames;
    const supplied = new Float32Array(count * 512).fill(0.004);
    const recognizer = createSpeechRecognizer(identity, "en", {
      async recognize(job) {
        jobs.push(structuredClone(job));
        return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
      }, stop() {},
    }, status => statuses.push(status), {
      // Quiet English has isolated active frames inside a word. Only five
      // consecutive frames confirm an onset; a later real pause must still cut.
      async detect() {
        const index = frame++;
        return { speech: index < 80 || (index >= 100 && index < 100 + onsetFrames)
          || (index >= 104 + onsetFrames && index < 154 + onsetFrames) || index >= 174 + onsetFrames };
      }, stop() {},
    });
    async function* packets() {
      for (let i = 0; i < count; i++) yield { ...chunk(i, true, 512), pcm: supplied.slice(i * 512, (i + 1) * 512).buffer };
    }
    await collect(recognizer.run(packets()));
    const laterCut = (164 + onsetFrames) * 32;
    assert.deepEqual(jobs.map(job => job.audioRange), onsetFrames === 5
      ? [{ startMs: 0, endMs: 2880 }, { startMs: 2880, endMs: laterCut }, { startMs: laterCut, endMs: count * 32 }]
      : [{ startMs: 0, endMs: laterCut }, { startMs: laterCut, endMs: count * 32 }]);
    let offset = 0;
    for (const job of jobs) {
      assert.deepEqual(job.pcm, supplied.slice(offset, offset + job.pcm.length));
      offset += job.pcm.length;
    }
    assert.equal(offset, supplied.length); assert.equal(frame, count);
    assert.ok(statuses.every(status => (status.queue?.pendingAudioMs ?? 0) <= 30000));
    assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
    assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 0);
  }
});

test("an odd learned pause retains frame alignment through a later maximum-length cut", async () => {
  const jobs: AsrJob[] = []; let frame = 0;
  const recognizer = createSpeechRecognizer(identity, "en", {
    async recognize(job) {
      jobs.push(structuredClone(job));
      return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
    }, stop() {},
  }, () => {}, {
    async detect() { const index = frame++; return { speech: index < 80 || index >= 101 }; }, stop() {},
  });
  await collect(recognizer.run(source(Array.from({ length: 750 }, (_, i) => chunk(i, true, 512)))));
  assert.deepEqual(jobs.map(job => job.audioRange), [
    { startMs: 0, endMs: 2912 }, { startMs: 2912, endMs: 22912 }, { startMs: 22912, endMs: 24000 },
  ]);
  assert.equal(jobs.reduce((total, job) => total + job.pcm.length, 0), 750 * 512);
  assert.ok(jobs.every(job => job.pcm.every(sample => sample === Math.fround(0.05))));
});

test("learned pause jobs retain the pending-job bound and reject a late stalled result", async () => {
  const jobs: AsrJob[] = []; const statuses: SessionStatus[] = [];
  let frame = 0; let release: (value: never) => void = () => {}; let stops = 0;
  const recognizer = createSpeechRecognizer(identity, "ja", {
    recognize(job) { jobs.push(job); return new Promise(resolve => { release = resolve; }); },
    stop() { stops++; },
  }, status => statuses.push(status), {
    async detect() { return { speech: frame++ % 32 < 16 }; }, stop() {},
  });
  await assert.rejects(collect(recognizer.run(source(Array.from({ length: 160 }, (_, i) => chunk(i, true, 512))))), /overloaded/);
  assert.equal(jobs.length, 1); assert.equal(stops, 1);
  assert.equal(statuses.at(-1)?.reason, "overloaded");
  assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
  assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 4256); // Four more onset frames before the same queue bound.
  const count = statuses.length;
  release({ revision: { ...jobs[0], sourceRevision: 1, final: true, text: "late" }, inferenceMs: 100 } as never);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(statuses.length, count);
});

test("confident learned silence releases only the first result before input EOF", async () => {
  for (const probability of [0.01, 0.05]) {
    const jobs: AsrJob[] = []; const statuses: SessionStatus[] = [];
    const submissions: number[] = [];
    let delivered = 0; let returned = 0; let frame = 0;
    const recognizer = createSpeechRecognizer(identity, "ja", {
      async recognize(job) {
        submissions.push(delivered);
        jobs.push(structuredClone(job));
        return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
      }, stop() {},
    }, status => statuses.push(status), {
      async detect() {
        const index = frame++;
        const speech = index < 32 || (probability < 0.05 && index >= 48 && index < 80);
        return { speech, probability: speech ? 0.99 : probability };
      }, stop() {},
    });
    const input = { [Symbol.asyncIterator]() { return {
      async next(): Promise<IteratorResult<AudioChunk>> {
        if (delivered < (probability < 0.05 ? 96 : 48)) return { done: false, value: chunk(delivered++, true, 512) };
        return new Promise(() => {}); // Input stays open after 512 ms of confident silence.
      },
      async return() { returned++; return { done: true as const, value: undefined }; },
    }; } };
    const stream = recognizer.run(input)[Symbol.asyncIterator]();
    const pending = stream.next();
    const result = await Promise.race([pending, new Promise<undefined>(resolve => setImmediate(() => resolve(undefined)))]);
    if (probability < 0.05) {
      assert.ok(result, "Confident silence must release text without waiting for more speech");
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(result.done, false); assert.equal(delivered, 96); assert.equal(returned, 0);
      assert.deepEqual(submissions, [48], "The first job must submit before the next speech starts");
      assert.equal(jobs.length, 1, "Later speech retains the original onset/EOF policy");
      assert.deepEqual(jobs[0].audioRange, { startMs: 0, endMs: 1280 });
      assert.deepEqual(jobs[0].pcm, new Float32Array(1280 * 16).fill(0.05));
      assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 1792);
    } else {
      assert.equal(result, undefined, "Uncertain quiet frames must preserve the onset confirmation policy");
      assert.equal(jobs.length, 0);
    }
    await recognizer.cancel(identity); await stream.return?.();
    assert.equal(returned, 1); assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
  }
});

test("learned long silence submits before another onset or input EOF", async () => {
  const jobs: AsrJob[] = []; const statuses: SessionStatus[] = [];
  let delivered = 0; let returned = 0; let frame = 0;
  const recognizer = createSpeechRecognizer(identity, "ja", {
    async recognize(job) {
      jobs.push(structuredClone(job));
      return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
    }, stop() {},
  }, status => statuses.push(status), {
    async detect() { return { speech: frame++ < 32 }; }, stop() {},
  });
  const input = { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<AudioChunk>> {
      if (delivered < 79) return { done: false, value: chunk(delivered++, true, 512) };
      return new Promise(() => {}); // Still open after 1,504 ms of detected silence.
    },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  const stream = recognizer.run(input)[Symbol.asyncIterator]();
  const pending = stream.next();
  const result = await Promise.race([pending, new Promise<undefined>(resolve => setImmediate(() => resolve(undefined)))]);
  assert.ok(result, "A completed utterance must not wait for another onset or EOF");
  assert.equal(result.done, false); assert.equal(delivered, 79); assert.equal(returned, 0);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].audioRange, { startMs: 0, endMs: 2272 });
  assert.deepEqual(jobs[0].pcm, new Float32Array(2272 * 16).fill(0.05));
  assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 256);
  await recognizer.cancel(identity); await stream.return?.();
  assert.equal(returned, 1); assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
  assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 256);
});

test("learned long pause retains exact context for subsequent speech and rejects a speech-free EOF tail", async () => {
  for (const resumed of [false, true]) {
    const jobs: AsrJob[] = []; const statuses: SessionStatus[] = []; let frame = 0;
    const count = resumed ? 272 : 232;
    const recognizer = createSpeechRecognizer(identity, "en", {
      async recognize(job) {
        jobs.push(structuredClone(job));
        return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
      }, stop() {},
    }, status => statuses.push(status), {
      async detect() { const index = frame++; return { speech: index < 32 || (resumed && index >= 232 && index < 264) }; }, stop() {},
    });
    await collect(recognizer.run(source(Array.from({ length: count }, (_, i) => chunk(i, true, 512)))));
    assert.deepEqual(jobs.map(job => job.audioRange), resumed
      ? [{ startMs: 0, endMs: 2272 }, { startMs: 2272, endMs: 8704 }]
      : [{ startMs: 0, endMs: 2272 }]);
    assert.equal(jobs.reduce((sum, job) => sum + job.pcm.length, 0), (resumed ? count * 512 : 2272 * 16));
    assert.ok(jobs.every(job => job.pcm.every(sample => sample === Math.fround(0.05))));
    assert.equal(frame, count); assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
    assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 0);
  }
});

test("learned short pauses bound long jobs while retaining EOF context unchanged", async () => {
  for (const tailSamples of [0, 341, 511, 853, 1365]) {
    const jobs: AsrJob[] = []; const statuses: SessionStatus[] = [];
    const supplied = new Float32Array(320504 + tailSamples).fill(0.05);
    supplied.fill(0, 320504);
    let frame = 0;
    const recognizer = createSpeechRecognizer(identity, "en", {
      async recognize(job) {
        jobs.push(structuredClone(job));
        return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
      }, stop() {},
    }, status => statuses.push(status), {
      // A 224 ms inactive pause after 11 s is shorter than the ordinary 500 ms
      // endpoint. The short EOF frames remain inactive, as in the measured case.
      async detect() { const index = frame++; return { speech: (index < 346 || index >= 353) && index < 625 }; }, stop() {},
    });
    async function* packets() {
      for (let offset = 0, sequence = 0; offset < supplied.length; offset += 1600, sequence++) {
        const packet = supplied.slice(offset, offset + 1600);
        const startMs = offset / 16; const endMs = startMs + packet.length / 16;
        yield { ...chunk(sequence), audioRange: { startMs, endMs },
          capture: { clockId: "fixture", startMs: 9000 + startMs, endMs: 9000 + endMs }, pcm: packet.buffer };
      }
    }
    await collect(recognizer.run(packets()));
    assert.deepEqual(jobs.map(job => job.audioRange), [
      { startMs: 0, endMs: 11200 }, { startMs: 11200, endMs: supplied.length / 16 },
    ]);
    let offset = 0;
    for (const job of jobs) {
      assert.deepEqual(job.pcm, supplied.slice(offset, offset + job.pcm.length));
      assert.ok(job.pcm.length >= 1600 && job.pcm.length <= 320000);
      offset += job.pcm.length;
    }
    assert.equal(offset, supplied.length);
    assert.equal(frame, Math.ceil(supplied.length / 512));
    assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
    assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 0);
  }
});

test("learned short pauses before 10 s retain the ordinary endpoint policy", async () => {
  const jobs: AsrJob[] = []; let frame = 0;
  const recognizer = createSpeechRecognizer(identity, "ja", {
    async recognize(job) {
      jobs.push(structuredClone(job));
      return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
    }, stop() {},
  }, () => {}, {
    async detect() { const index = frame++; return { speech: index < 80 || index >= 87 }; }, stop() {},
  });
  await collect(recognizer.run(source(Array.from({ length: 160 }, (_, i) => chunk(i, true, 512)))));
  assert.deepEqual(jobs.map(job => job.audioRange), [{ startMs: 0, endMs: 5120 }]);
  assert.deepEqual(jobs[0].pcm, new Float32Array(160 * 512).fill(0.05));
});

test("late five-frame learned pauses avoid forced speech cuts and preserve exact EOF PCM", async () => {
  for (const pauseFrames of [4, 5, 6]) for (const tailSamples of [0, 341, 511, 853, 1365]) {
    const jobs: AsrJob[] = []; const statuses: SessionStatus[] = []; let frame = 0;
    const supplied = new Float32Array(336504 + tailSamples).fill(0.004);
    supplied.fill(0, 336504);
    const recognizer = createSpeechRecognizer(identity, "ja", {
      async recognize(job) {
        jobs.push(structuredClone(job));
        return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
      }, stop() {},
    }, status => statuses.push(status), {
      // Quiet Japanese has a late 160/192 ms inactive pause. Four frames
      // remain too short; only five or more should avoid the maximum cut.
      async detect() { const index = frame++; return { speech: (index < 450 || index >= 450 + pauseFrames) && index < 656 }; }, stop() {},
    });
    async function* packets() {
      for (let offset = 0, sequence = 0; offset < supplied.length; offset += 1600, sequence++) {
        const packet = supplied.slice(offset, offset + 1600);
        const startMs = offset / 16; const endMs = startMs + packet.length / 16;
        yield { ...chunk(sequence), audioRange: { startMs, endMs },
          capture: { clockId: "fixture", startMs: 9000 + startMs, endMs: 9000 + endMs }, pcm: packet.buffer };
      }
    }
    await collect(recognizer.run(packets()));
    const splitMs = pauseFrames >= 5 ? (450 + Math.ceil(pauseFrames / 2)) * 32 : 20000;
    assert.deepEqual(jobs.map(job => job.audioRange), [
      { startMs: 0, endMs: splitMs }, { startMs: splitMs, endMs: supplied.length / 16 },
    ]);
    let offset = 0;
    for (const job of jobs) {
      assert.deepEqual(job.pcm, supplied.slice(offset, offset + job.pcm.length));
      assert.ok(job.pcm.length >= 1600 && job.pcm.length <= 320000);
      offset += job.pcm.length;
    }
    assert.equal(offset, supplied.length); assert.equal(frame, Math.ceil(supplied.length / 512));
    assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
    assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 0);
  }
});

test("learned admission retains quiet onset context before delayed speech detection", async () => {
  for (const detected of [false, true]) {
    const jobs: AsrJob[] = []; const statuses: SessionStatus[] = []; let frame = 0;
    const count = detected ? 100 : 1250; // Forty seconds without learned speech.
    const supplied = new Float32Array(count * 512).fill(0.004);
    const recognizer = createSpeechRecognizer(identity, "en", {
      async recognize(job) {
        jobs.push(structuredClone(job));
        return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
      }, stop() {},
    }, status => statuses.push(status), {
      // The measured quiet English input first receives learned admission at
      // 1,696 ms. Earlier low-energy context must survive that delayed decision.
      async detect() { return { speech: frame++ >= 53 && detected }; }, stop() {},
    });
    async function* packets() {
      for (let i = 0; i < count; i++) yield { ...chunk(i, true, 512), pcm: supplied.slice(i * 512, (i + 1) * 512).buffer };
    }
    await collect(recognizer.run(packets()));
    if (detected) {
      assert.deepEqual(jobs.map(job => job.audioRange), [{ startMs: 0, endMs: 3200 }]);
      assert.deepEqual(jobs[0].pcm, supplied);
    } else assert.equal(jobs.length, 0);
    assert.equal(frame, count);
    assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
    assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 0);
    assert.ok(statuses.every(status => (status.queue?.pendingAudioMs ?? 0) <= 20000));
  }
});

test("learned English splits confirmed short pauses after six seconds without cutting Japanese or shorter pauses", async () => {
  for (const language of ["en", "ja"] as const) for (const pauseFrames of [4, 5, 7]) {
    const jobs: AsrJob[] = []; const statuses: SessionStatus[] = []; let frame = 0;
    const supplied = Float32Array.from({ length: 290 * 512 }, (_, i) => (i % 127) / 1270);
    const recognizer = createSpeechRecognizer(identity, language, {
      async recognize(job) {
        jobs.push(structuredClone(job));
        return { revision: { ...job, sourceRevision: 1, final: true, text: "transport fixture" }, inferenceMs: 1 };
      }, stop() {},
    }, status => statuses.push(status), {
      async detect() { const index = frame++; return { speech: index < 200 || index >= 200 + pauseFrames }; }, stop() {},
    });
    async function* packets() {
      for (let i = 0; i < 290; i++) yield { ...chunk(i, true, 512), pcm: supplied.slice(i * 512, (i + 1) * 512).buffer };
    }
    await collect(recognizer.run(packets()));
    const cut = (200 + Math.ceil(pauseFrames / 2)) * 32;
    assert.deepEqual(jobs.map(job => job.audioRange), language === "en" && pauseFrames >= 5
      ? [{ startMs: 0, endMs: cut }, { startMs: cut, endMs: 9280 }]
      : [{ startMs: 0, endMs: 9280 }]);
    let offset = 0;
    for (const job of jobs) {
      assert.deepEqual(job.pcm, supplied.slice(offset, offset + job.pcm.length));
      offset += job.pcm.length;
    }
    assert.equal(offset, supplied.length); assert.equal(frame, 290);
    assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0);
    assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 0);
  }
});
