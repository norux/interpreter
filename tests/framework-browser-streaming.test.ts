import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioChunk, MediaTargetId, SessionStatus, TranscriptRevision } from "../packages/contracts";
import type { AsrJob, AsrSegment } from "../packages/engines-browser/asr-protocol";
import { createStreamingSpeechRecognizer } from "../packages/engines-browser/streaming-speech";

const identity = { sessionId: "streaming", targetId: "tab" as MediaTargetId, epoch: 0 };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(language: "en" | "ja" | "ko" | "auto", outputs: { text: string; segments: AsrSegment[]; language?: "en" | "ja" | "ko"; confidence?: number }[]) {
  const jobs: AsrJob[] = []; const statuses: SessionStatus[] = [];
  let sequence = 0; let returned = 0; let detectorStops = 0; let executorStops = 0;
  const queued: AudioChunk[] = [];
  let waiting: ((value: IteratorResult<AudioChunk>) => void) | undefined;
  const input = { [Symbol.asyncIterator]() { return {
    next() { const packet = queued.shift(); return packet ? Promise.resolve({ done: false as const, value: packet })
      : new Promise<IteratorResult<AudioChunk>>(resolve => { waiting = resolve; }); },
    async return() { returned++; waiting?.({ done: true, value: undefined }); return { done: true as const, value: undefined }; },
  }; } };
  const recognizer = createStreamingSpeechRecognizer(identity, language, {
    async recognize(job) {
      jobs.push(structuredClone(job));
      const output = outputs[Math.min(jobs.length - 1, outputs.length - 1)];
      return { revision: { identity, utteranceId: job.utteranceId, audioRange: job.audioRange, language: output.language ?? language,
        sourceRevision: 1, final: true, text: output.text,
        ...(output.confidence === undefined ? {} : { confidence: { measure: "whisper-language-probability", value: output.confidence } }) }, inferenceMs: 0, segments: output.segments };
    }, stop() { executorStops++; },
  }, status => statuses.push(status), {
    async detect(pcm) { return { speech: pcm.some(sample => sample !== 0) }; }, stop() { detectorStops++; },
  });
  async function feed(frames: number, speech = true) {
    for (let i = 0; i < frames; i++) {
      const startMs = sequence * 32;
      const packet: AudioChunk = { identity, sequence: sequence++, scope: "tab-mix", audioRange: { startMs, endMs: startMs + 32 },
        capture: { clockId: "clock", startMs, endMs: startMs + 32 }, sampleRate: 16000, channels: 1,
        sampleFormat: "pcm-f32le", pcm: new Float32Array(512).fill(speech ? 0.05 : 0).buffer };
      if (waiting) { const receive = waiting; waiting = undefined; receive({ done: false, value: packet }); } else queued.push(packet);
    }
    await tick();
  }
  return { recognizer, input, feed, jobs, statuses, get returned() { return returned; }, get stops() { return [executorStops, detectorStops]; } };
}

test("automatic streaming re-detects each turn and preserves its onset while input stays open", async () => {
  const f = fixture("auto", [
    { language: "en", text: "Hello.", segments: [{ text: "Hello.", startMs: 0, endMs: 1000 }] },
    { language: "en", text: "Hello.", segments: [{ text: "Hello.", startMs: 0, endMs: 1000 }] },
    { language: "ja", text: "こんにちは。", segments: [{ text: "こんにちは。", startMs: 0, endMs: 1000 }] },
    { language: "ja", text: "こんにちは。", segments: [{ text: "こんにちは。", startMs: 0, endMs: 1000 }] },
    { language: "ko", text: "안녕하세요.", segments: [{ text: "안녕하세요.", startMs: 0, endMs: 1000 }] },
    { language: "ko", text: "안녕하세요.", segments: [{ text: "안녕하세요.", startMs: 0, endMs: 1000 }] },
  ]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator]();
  try {
    const originals: TranscriptRevision[] = [];
    for (let turn = 0; turn < 3; turn++) {
      const next = stream.next();
      await f.feed(32); await f.feed(8, false);
      const result = await Promise.race([next, tick().then(() => undefined)]);
      assert.ok(result?.value, "A turn must emit without waiting for EOF or the next speaker");
      originals.push(result.value);
    }
    assert.deepEqual(originals.map(source => source.language), ["en", "ja", "ko"]);
    assert.deepEqual(originals.map(source => source.text), ["Hello.", "こんにちは。", "안녕하세요."]);
    assert.equal(f.jobs.every(job => job.language === "auto"), true);
    for (const [index, original] of originals.entries()) assert.ok(original.audioRange.startMs <= index * 1280,
      "Detection must retain the beginning of each turn");
    assert.equal(f.returned, 0);
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("automatic streaming retains uncertain initial PCM until later snapshots identify the language", async () => {
  const f = fixture("auto", [
    { language: "en", confidence: 0.4, text: "A mistaken beginning.", segments: [{ text: "A mistaken beginning.", startMs: 0, endMs: 900 }] },
    { language: "ja", confidence: 0.98, text: "こんにちは。明日の会議です。", segments: [{ text: "こんにちは。明日の会議です。", startMs: 0, endMs: 1800 }] },
    { language: "ja", confidence: 0.98, text: "こんにちは。明日の会議です。", segments: [{ text: "こんにちは。明日の会議です。", startMs: 0, endMs: 1800 }] },
  ]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const next = stream.next();
  try {
    await f.feed(32);
    assert.equal(await Promise.race([next, tick().then(() => undefined)]), undefined);
    await f.feed(32); await f.feed(8, false);
    const result = await next;
    assert.equal(result.value?.language, "ja"); assert.equal(result.value?.text, "こんにちは。");
    assert.equal(result.value?.audioRange.startMs, 0);
    assert.equal(f.jobs.every(job => job.audioRange.startMs === 0), true, "Language correction must replay the original onset PCM");
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("automatic speech boundaries drain an unfinished tail before the next language", async () => {
  const text = "今日は晴れです。そのあと本";
  const f = fixture("auto", [{ language: "ja", confidence: 0.99, text, segments: [
    { text: "今日は晴れです。", startMs: 0, endMs: 500 },
    { text: "そのあと本", startMs: 500, endMs: 1000 },
  ] }]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const first = stream.next();
  try {
    await f.feed(32); await f.feed(8, false);
    assert.equal(f.jobs.length, 2, "A completed speech boundary must not leave PCM queued for re-detection");
    assert.equal((await first).value?.text, "今日は晴れです。");
    assert.equal((await stream.next()).value?.text, "そのあと本");
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("streaming confirms corrected sentence text without waiting for silence or EOF", async () => {
  const f = fixture("en", [
    { text: "We will meet.", segments: [{ text: "We will meet.", startMs: 0, endMs: 1000 }] },
    { text: "We will not meet today.", segments: [{ text: "We will not meet today.", startMs: 0, endMs: 1500 }] },
    { text: "We will not meet today. Tomorrow", segments: [
      { text: "We will not meet today.", startMs: 0, endMs: 1500 }, { text: " Tomorrow", startMs: 1500, endMs: 3000 },
    ] },
  ]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(32); assert.equal(f.jobs.length, 1);
    await f.feed(32); assert.equal(f.jobs.length, 2);
    let received = false; void pending.then(() => { received = true; }); await tick(); assert.equal(received, false);
    await f.feed(32);
    const result = await Promise.race([pending, tick().then(() => undefined)]);
    assert.ok(result, "Stable completed text must emit while audio is still open and speaking");
    assert.equal(result.value?.text, "We will not meet today."); assert.equal(result.value?.final, true);
    assert.equal(f.returned, 0); assert.equal(f.jobs.every(job => job.timestamps), true);
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("streaming recognizes Japanese sentence endings without punctuation", async () => {
  const text = "今日は会議をしません";
  const f = fixture("ja", [{ text, segments: [{ text, startMs: 0, endMs: 1000 }] }]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(64);
    const result = await Promise.race([pending, tick().then(() => undefined)]);
    assert.equal(result?.value?.text, text);
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("a draft ending in an English connector stays pending through a brief hesitation", async () => {
  const text = "If you want to.";
  const f = fixture("en", [{ text, segments: [{ text, startMs: 0, endMs: 1000 }] }]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(64); await f.feed(8, false);
    assert.equal(await Promise.race([pending, tick().then(() => undefined)]), undefined);
  } finally { await f.recognizer.cancel(identity); await assert.rejects(pending, /cancelled/); await stream.return?.(); }
});

test("speech-free energetic input never triggers streaming inference", async () => {
  let calls = 0;
  const recognizer = createStreamingSpeechRecognizer(identity, "en", {
    async recognize() { calls++; throw new Error("Unexpected noise transcription"); }, stop() {},
  }, () => {}, { async detect() { return { speech: false }; }, stop() {} });
  async function* noise() {
    for (let sequence = 0; sequence < 1500; sequence++) {
      const startMs = sequence * 32;
      yield { identity, sequence, scope: "tab-mix" as const, audioRange: { startMs, endMs: startMs + 32 },
        capture: { clockId: "noise", startMs, endMs: startMs + 32 }, sampleRate: 16000, channels: 1,
        sampleFormat: "pcm-f32le" as const, pcm: new Float32Array(512).fill(0.05).buffer };
    }
  }
  const results = []; for await (const result of recognizer.run(noise())) results.push(result);
  assert.equal(calls, 0); assert.deepEqual(results, []);
});

test("streaming rejects audio clock/scope gaps and never joins the following audio", async () => {
  for (const gap of ["clock", "scope", "sequence"] as const) {
    let jobs = 0; const statuses: SessionStatus[] = [];
    const recognizer = createStreamingSpeechRecognizer(identity, "en", {
      async recognize() { jobs++; throw new Error("No inference before one second"); }, stop() {},
    }, status => statuses.push(status), { async detect() { return { speech: true }; }, stop() {} });
    async function* input() {
      for (let i = 0; i < 2; i++) {
        const startMs = i * 32;
        yield { identity, sequence: gap === "sequence" && i ? 2 : i,
          scope: (gap === "scope" && i ? "selected-video" : "tab-mix") as AudioChunk["scope"],
          audioRange: { startMs, endMs: startMs + 32 }, capture: { clockId: gap === "clock" && i ? "new" : "clock", startMs, endMs: startMs + 32 },
          sampleRate: 16000, channels: 1, sampleFormat: "pcm-f32le" as const, pcm: new Float32Array(512).fill(0.05).buffer };
      }
    }
    const collect = async () => { for await (const _result of recognizer.run(input())) {} };
    await assert.rejects(collect(), /audio-gap/); assert.equal(jobs, 0);
    assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0); assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 32);
  }
});

test("Stop cancels active incremental inference and rejects its late sentence", async () => {
  let release: (value: { revision: TranscriptRevision; inferenceMs: number; segments: AsrSegment[] }) => void = () => {};
  let job: AsrJob | undefined; let calls = 0; let returned = 0;
  const recognizer = createStreamingSpeechRecognizer(identity, "en", {
    recognize(value) { calls++; job = value; return new Promise(resolve => { release = resolve; }); }, stop() {},
  }, () => {}, { async detect() { return { speech: true }; }, stop() {} });
  const input = { [Symbol.asyncIterator]() { let sequence = 0; return {
    async next(): Promise<IteratorResult<AudioChunk>> {
      if (sequence >= 96) return new Promise(() => {});
      const startMs = sequence * 32;
      return { done: false, value: { identity, sequence: sequence++, scope: "tab-mix", audioRange: { startMs, endMs: startMs + 32 },
        capture: { clockId: "clock", startMs, endMs: startMs + 32 }, sampleRate: 16000, channels: 1, sampleFormat: "pcm-f32le",
        pcm: new Float32Array(512).fill(0.05).buffer } };
    }, async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  const stream = recognizer.run(input)[Symbol.asyncIterator](); const pending = stream.next(); await tick();
  assert.equal(calls, 1, "Draft updates must coalesce behind one active model call");
  await recognizer.cancel({ ...identity, epoch: 1 }); assert.equal(returned, 0);
  await recognizer.cancel(identity); await assert.rejects(pending, /cancelled/); assert.equal(returned, 1);
  assert.ok(job);
  release({ revision: { identity, utteranceId: job.utteranceId, language: "en", audioRange: job.audioRange,
    sourceRevision: 1, final: true, text: "Late sentence." }, inferenceMs: 0, segments: [{ text: "Late sentence.", startMs: 0, endMs: 900 }] });
  await tick(); assert.equal(calls, 1); await stream.return?.();
});

test("input EOF drains an unfinished phrase once while retaining real PCM ranges", async () => {
  const jobs: AsrJob[] = [];
  const recognizer = createStreamingSpeechRecognizer(identity, "en", {
    async recognize(job) {
      jobs.push(structuredClone(job));
      return { revision: { identity, utteranceId: job.utteranceId, language: "en", audioRange: job.audioRange,
        sourceRevision: 1, final: true, text: "An unfinished phrase" }, inferenceMs: 0,
      segments: [{ text: "An unfinished phrase", startMs: 0, endMs: job.pcm.length / 16 }] };
    }, stop() {},
  }, () => {}, { async detect() { return { speech: true }; }, stop() {} });
  async function* input() {
    for (let sequence = 0; sequence < 10; sequence++) {
      const startMs = sequence * 32;
      yield { identity, sequence, scope: "tab-mix" as const, audioRange: { startMs, endMs: startMs + 32 },
        capture: { clockId: "clock", startMs, endMs: startMs + 32 }, sampleRate: 16000, channels: 1,
        sampleFormat: "pcm-f32le" as const, pcm: new Float32Array(512).fill(0.05).buffer };
    }
  }
  const results = []; for await (const result of recognizer.run(input())) results.push(result);
  assert.equal(jobs.length, 1); assert.equal(results.length, 1); assert.equal(results[0].text, "An unfinished phrase");
  assert.deepEqual(results[0].audioRange, { startMs: 0, endMs: 320 }); assert.equal(jobs[0].pcm.length, 5120);
});

test("Japanese snapshot limit joins timestamp fragments and retains the unfinished next sentence", async () => {
  const first = [
    { text: "1時半なら", startMs: 0, endMs: 3000 },
    { text: "大丈夫。", startMs: 3000, endMs: 6000 },
    { text: "肉を使わない", startMs: 6000, endMs: 12000 },
  ];
  const next = [{ text: "肉を使わない料理もあるかな？", startMs: 0, endMs: 7000 }];
  const f = fixture("ja", Array.from({ length: 11 }, () => ({ text: "1時半なら", segments: [{ text: "1時半なら", startMs: 0, endMs: 1000 }] }))
    .concat([{ text: first.map(s=>s.text).join(""), segments: first }, { text: next[0].text, segments: next }]));
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(375);
    assert.equal((await pending).value?.text, "1時半なら大丈夫。");
    await f.feed(32);
    assert.equal(f.jobs.at(-1)?.audioRange.startMs, 6000, "Incomplete speech must be decoded with the following audio");
    const second = stream.next(); await f.feed(32);
    assert.equal((await second).value?.text, "肉を使わない料理もあるかな？");
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});


test("a stable sentence emits even when the model puts its following words in the same timestamp segment", async () => {
  const f = fixture("en", [
    { text: "We will not meet today.", segments: [{ text: "We will not meet today.", startMs: 0, endMs: 1024 }] },
    { text: "We will not meet today. Tomorrow", segments: [{ text: "We will not meet today. Tomorrow", startMs: 0, endMs: 2048 }] },
  ]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(64);
    const result = await Promise.race([pending, tick().then(() => undefined)]);
    assert.equal(result?.value?.text, "We will not meet today.");
    assert.deepEqual(result?.value?.audioRange, { startMs: 0, endMs: 2048 });
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("Japanese punctuation correction cannot replay a committed prefix in the retained timestamp segment", async () => {
  const first = "いいね。それから本";
  const corrected = "いいね、それから本を持っていくよ。";
  const f = fixture("ja", [first, first, corrected, corrected].map(text=>({ text, segments: [{ text, startMs: 0, endMs: 1000 }] })));
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(64); assert.equal((await pending).value?.text, "いいね。");
    const next = stream.next(); await f.feed(64);
    assert.equal((await next).value?.text, "それから本を持っていくよ。");
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});


test("an English comma followed by a new independent clause releases the stable finite sentence", async () => {
  const text = "We will not meet today, let's meet at the station";
  const f = fixture("en", [{ text, segments: [{ text, startMs: 0, endMs: 1024 }] },
    { text, segments: [{ text, startMs: 0, endMs: 2048 }] }]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(64);
    const result = await Promise.race([pending, tick().then(() => undefined)]);
    assert.equal(result?.value?.text, "We will not meet today,");
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});


test("sentence splitting preserves English abbreviations and decimal numbers", async () => {
  const f = fixture("en", [
    { text: "Dr. Lee arrived. It costs 3.14 dollars.", segments: [{ text: "Dr. Lee arrived. It costs 3.14 dollars.", startMs: 0, endMs: 1000 }] },
  ]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(64); const result = await pending;
    assert.equal(result.value?.text, "Dr. Lee arrived.");
    const second = await stream.next(); assert.equal(second.value?.text, "It costs 3.14 dollars.");
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("a long pause releases stable unpunctuated speech without waiting for EOF", async () => {
  const text = "An unfinished phrase";
  const f = fixture("en", [{ text, segments: [{ text, startMs: 0, endMs: 900 }] }]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(32); await f.feed(60, false);
    const result = await Promise.race([pending, tick().then(() => undefined)]);
    assert.equal(result?.value?.text, text); assert.equal(f.returned, 0);
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});


test("unpunctuated continuous speech flushes at twelve seconds while the input remains open", async () => {
  const text = "An unfinished phrase";
  const f = fixture("en", [{ text, segments: [{ text, startMs: 0, endMs: 1000 }] }]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator](); const pending = stream.next();
  try {
    await f.feed(375);
    const result = await Promise.race([pending, tick().then(() => undefined)]);
    assert.equal(result?.value?.text, text); assert.equal(f.returned, 0);
    assert.equal(f.jobs.at(-1)?.pcm.length, 192000);
    assert.deepEqual(f.jobs.at(-1)?.audioRange, { startMs: 0, endMs: 12000 });
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});

test("stalled incremental inference retains bounded headroom and fails without hiding audio loss", async () => {
  let calls = 0; let stops = 0; const statuses: SessionStatus[] = [];
  const recognizer = createStreamingSpeechRecognizer(identity, "en", {
    recognize() { calls++; return new Promise(() => {}); }, stop() { stops++; },
  }, status => statuses.push(status), { async detect() { return { speech: true }; }, stop() {} });
  async function* input() {
    for (let sequence = 0; sequence < 689; sequence++) {
      const startMs = sequence * 32;
      yield { identity, sequence, scope: "tab-mix" as const, audioRange: { startMs, endMs: startMs + 32 },
        capture: { clockId: "clock", startMs, endMs: startMs + 32 }, sampleRate: 16000, channels: 1,
        sampleFormat: "pcm-f32le" as const, pcm: new Float32Array(512).fill(0.05).buffer };
    }
  }
  const collect = async () => { for await (const _result of recognizer.run(input())) {} };
  await assert.rejects(collect(), /overloaded/);
  assert.equal(calls, 1); assert.equal(stops, 1);
  assert.ok(statuses.every(status => (status.queue?.pendingAudioMs ?? 0) <= 22000));
  assert.equal(statuses.at(-1)?.queue?.pendingAudioMs, 0); assert.equal(statuses.at(-1)?.queue?.droppedAudioMs, 22016);
});


test("manual Korean streaming fixes every ASR job to Korean without language detection", async () => {
  const f = fixture("ko", [{ text: "안녕하세요.", confidence: 0.1, segments: [{ text: "안녕하세요.", startMs: 0, endMs: 1000 }] }]);
  const stream = f.recognizer.run(f.input)[Symbol.asyncIterator]();
  try {
    const next = stream.next();
    await f.feed(32); await f.feed(8, false);
    const result = await next;
    assert.equal(result.value?.language, "ko");
    assert.equal(result.value?.text, "안녕하세요.");
    assert.ok(f.jobs.length > 0);
    assert.ok(f.jobs.every(job => job.language === "ko"));
  } finally { await f.recognizer.cancel(identity); await stream.return?.(); }
});
