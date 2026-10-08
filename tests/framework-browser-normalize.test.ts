import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioChunk, MediaTargetId } from "../packages/contracts";
import { validAudio } from "../packages/core/audio-queue";
import { normalizeSelectedAudio } from "../packages/engines-browser/normalize-audio";

const identity = { sessionId: "normalize-unit", targetId: "selected" as MediaTargetId, epoch: 4 };
function packets(samples: Float32Array, rate: number, size: number): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  for (let offset = 0; offset < samples.length; offset += size) {
    const pcm = samples.slice(offset, offset + size);
    const startMs = offset / rate * 1000, endMs = (offset + pcm.length) / rate * 1000;
    chunks.push({ identity, scope: "selected-video", sequence: chunks.length,
      audioRange: { startMs: 123 + startMs, endMs: 123 + endMs },
      capture: { clockId: "worklet", startMs: 9000 + startMs, endMs: 9000 + endMs },
      channels: 1, sampleFormat: "pcm-f32le", sampleRate: rate, pcm: pcm.buffer });
  }
  return chunks;
}
async function* source(chunks: AudioChunk[]) { yield* chunks; }
async function collect(stream: AsyncIterable<AudioChunk>) {
  const chunks: AudioChunk[] = []; for await (const chunk of stream) chunks.push(chunk);
  const pcm = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.pcm.byteLength / 4, 0));
  let cursor = 0;
  for (const chunk of chunks) { const samples = new Float32Array(chunk.pcm); pcm.set(samples, cursor); cursor += samples.length; }
  return { chunks, pcm };
}

test("normalization preserves clocks/duration through arbitrary partitions, including 44.1 kHz", async () => {
  for (const rate of [16000, 44100, 48000]) {
    const samples = Float32Array.from({ length: rate + 137 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 1000 * i / rate));
    const full = await collect(normalizeSelectedAudio(identity, source(packets(samples, rate, 2048))));
    const split = await collect(normalizeSelectedAudio(identity, source(packets(samples, rate, 701))));
    assert.deepEqual(split.pcm, full.pcm, "No packet-size-dependent phase reset or lost samples");
    assert.equal(full.pcm.length, Math.floor(samples.length * 16000 / rate));
    assert.deepEqual(full.chunks.map(chunk => chunk.sequence), full.chunks.map((_, i) => i));
    for (const [i, chunk] of full.chunks.entries()) {
      assert.ok(validAudio(chunk)); assert.deepEqual(chunk.identity, identity);
      assert.equal(chunk.scope, "selected-video"); assert.equal(chunk.capture.clockId, "worklet");
      assert.equal(chunk.sampleRate, 16000); assert.ok(chunk.pcm.byteLength <= 12800);
      assert.ok(Math.abs(chunk.capture.startMs - chunk.audioRange.startMs - 8877) < 1e-9);
      if (i) assert.equal(chunk.audioRange.startMs, full.chunks[i - 1].audioRange.endMs);
    }
    const last = full.chunks.at(-1); assert.ok(last);
    assert.ok(Math.abs(last.audioRange.endMs - 123 - samples.length / rate * 1000) < 0.0625);
    if (rate === 16000) assert.deepEqual(full.pcm, samples);
  }
});

test("downsampling preserves speech-band gain and rejects aliased 9/12 kHz tones", async () => {
  for (const rate of [44100, 48000]) {
    for (const frequency of [1000, 6500, 9000, 12000]) {
      const samples = Float32Array.from({ length: rate }, (_, i) => 0.25 * Math.sin(2 * Math.PI * frequency * i / rate));
      const { pcm } = await collect(normalizeSelectedAudio(identity, source(packets(samples, rate, 2048))));
      const steady = pcm.subarray(100, pcm.length - 100);
      const gain = Math.sqrt(steady.reduce((sum, x) => sum + x * x, 0) / steady.length) / (0.25 / Math.SQRT2);
      if (frequency <= 6500) assert.ok(gain > 0.88 && gain < 1.02, `${rate}/${frequency}: gain ${gain}`);
      else assert.ok(gain < 0.01, `${rate}/${frequency}: alias gain ${gain}`);
    }
  }
});

test("normalizer rejects gaps before any sample across a changed sequence/clock/rate/epoch", async () => {
  const chunks = packets(new Float32Array(4096).fill(0.1), 48000, 2048);
  for (const replacement of [{ ...chunks[1], sequence: 2 }, { ...chunks[1], identity: { ...identity, epoch: 5 } },
    { ...chunks[1], capture: { ...chunks[1].capture, clockId: "other" } },
    { ...chunks[1], audioRange: { startMs: 123 + 100, endMs: 123 + 100 + 2048 / 48 }, capture: { clockId: "worklet", startMs: 9100, endMs: 9100 + 2048 / 48 } },
    { ...packets(new Float32Array(2048), 44100, 2048)[0], sequence: 1,
      audioRange: { startMs: chunks[0].audioRange.endMs, endMs: chunks[0].audioRange.endMs + 2048 / 44.1 },
      capture: { clockId: "worklet", startMs: chunks[0].capture.endMs, endMs: chunks[0].capture.endMs + 2048 / 44.1 } }]) {
    let returned = 0;
    const audio = { async *[Symbol.asyncIterator]() { try { yield chunks[0]; yield replacement; } finally { returned++; } } };
    const iterator = normalizeSelectedAudio(identity, audio)[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done, false);
    await assert.rejects(iterator.next(), /audio-gap/);
    assert.equal(returned, 1); assert.equal((await iterator.next()).done, true);
  }
});

test("normalization rejects unsupported formats, shared/oversized/nonfinite PCM and unknown scopes", async () => {
  const chunk = packets(new Float32Array(2048), 48000, 2048)[0];
  for (const invalid of [{ ...chunk, scope: "unknown" as AudioChunk["scope"] }, { ...chunk, channels: 2 },
    { ...chunk, sampleRate: 24000 }, { ...chunk, sampleFormat: "pcm-s16le" as const },
    { ...chunk, pcm: new SharedArrayBuffer(8192) as unknown as ArrayBuffer },
    { ...chunk, pcm: new Float32Array(2048).fill(Number.NaN).buffer },
    { ...chunk, pcm: new Float32Array(2048).fill(1.01).buffer },
    packets(new Float32Array(2049), 48000, 2049)[0]]) {
    await assert.rejects(collect(normalizeSelectedAudio(identity, source([invalid]))), /engine-failed/);
  }
});

test("return closes the input during an outstanding read and never emits its late chunk", async () => {
  let returned = 0, read: (value: IteratorResult<AudioChunk>) => void = () => {};
  const audio = { [Symbol.asyncIterator]() { return {
    next: () => new Promise<IteratorResult<AudioChunk>>(resolve => { read = resolve; }),
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  const stream = normalizeSelectedAudio(identity, audio);
  const iterator = stream[Symbol.asyncIterator](); const pending = iterator.next();
  await iterator.return?.(); await iterator.return?.(); assert.equal(returned, 1);
  read({ done: false, value: packets(new Float32Array(2048), 48000, 2048)[0] });
  assert.equal((await pending).done, true);
  assert.throws(() => stream[Symbol.asyncIterator](), /one consumer/);
});


test("tab normalization preserves mixed-input scope, clocks and every resampled sample", async () => {
  const chunks = packets(Float32Array.from({length:48000},(_,i)=>0.2*Math.sin(2*Math.PI*1000*i/48000)),48000,2048);
  const video = await collect(normalizeSelectedAudio(identity,source(chunks)));
  const tab = await collect(normalizeSelectedAudio(identity,source(chunks.map(chunk=>({...chunk,scope:"tab-mix"})))));
  assert.deepEqual(tab.pcm,video.pcm);
  assert.deepEqual(tab.chunks,video.chunks.map(chunk=>({...chunk,scope:"tab-mix"})));
});

test("normalization retires context if input scope changes mid-session", async () => {
  const chunks = packets(new Float32Array(4096).fill(0.1),48000,2048);
  const iterator = normalizeSelectedAudio(identity,source([chunks[0],{...chunks[1],scope:"tab-mix"}]))[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done,false);
  await assert.rejects(iterator.next(),/audio-gap/);
});
