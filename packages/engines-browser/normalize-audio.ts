import type { AudioChunk, SessionIdentity } from "../contracts";
import { validAudio } from "../core/audio-queue";
import { sameIdentity } from "../core/identity";

// Engine boundary for the existing mono Float32 worklet. The centered 64-tap
// Hann-windowed sinc rejects frequencies above the 16 kHz output's Nyquist
// limit. It retains 32 future input samples, without shifting the sample clock.
export function normalizeSelectedAudio(identity: SessionIdentity, audio: AsyncIterable<AudioChunk>): AsyncIterable<AudioChunk> {
  const selected = { ...identity };
  let started = false;
  return {
    [Symbol.asyncIterator]() {
      if (started) throw new Error("Audio normalization has one consumer");
      started = true;
      const input = audio[Symbol.asyncIterator]();
      let closed = false;
      let ended = false;
      let pending = false;
      let first: AudioChunk | undefined;
      let previous: AudioChunk | undefined;
      let retained = new Float32Array(0);
      let base = 0;
      let total = 0;
      let outputSamples = 0;
      let sequence = 0;
      const phases = new Map<number, Float64Array>();

      async function close() {
        if (closed) return;
        closed = true; retained = new Float32Array(0); phases.clear();
        first = undefined; previous = undefined;
        await input.return?.();
      }
      function append(chunk: AudioChunk) {
        if (!sameIdentity(selected, chunk.identity)) throw new Error("audio-gap");
        if (!validAudio(chunk) || chunk.scope !== "selected-video" || chunk.channels !== 1
          || chunk.sampleFormat !== "pcm-f32le" || ![16000, 44100, 48000].includes(chunk.sampleRate)
          || !(chunk.pcm instanceof ArrayBuffer) || chunk.pcm.byteLength > 8192) throw new Error("engine-failed");
        const pcm = new Float32Array(chunk.pcm);
        if (!pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)) throw new Error("engine-failed");
        if (previous && (chunk.sequence !== previous.sequence + 1 || chunk.sampleRate !== previous.sampleRate
          || chunk.capture.clockId !== previous.capture.clockId
          || Math.abs(chunk.audioRange.startMs - previous.audioRange.endMs) > 0.001
          || Math.abs(chunk.capture.startMs - previous.capture.endMs) > 0.001)) throw new Error("audio-gap");
        first ??= chunk; previous = chunk;
        const joined = new Float32Array(retained.length + pcm.length);
        joined.set(retained); joined.set(pcm, retained.length); retained = joined;
        total += pcm.length;
      }
      function render(): AudioChunk | undefined {
        if (!first) return;
        const rate = first.sampleRate;
        const count = Math.min(3200, Math.max(0, (ended || rate === 16000
          ? Math.floor(total * 16000 / rate) : Math.ceil((total - 32) * 16000 / rate)) - outputSamples));
        if (!count) return;
        const pcm = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const numerator = (outputSamples + i) * rate;
          const center = Math.floor(numerator / 16000);
          if (rate === 16000) { pcm[i] = retained[center - base]; continue; }
          const phase = numerator % 16000;
          let kernel = phases.get(phase);
          if (!kernel) {
            kernel = new Float64Array(64);
            let sum = 0;
            for (let tap = 0; tap < 64; tap++) {
              const distance = tap - 31 - phase / 16000;
              const angle = 2 * Math.PI * 7200 / rate * distance;
              const weight = (angle === 0 ? 1 : Math.sin(angle) / angle)
                * (0.5 + 0.5 * Math.cos(Math.PI * distance / 32));
              kernel[tap] = weight; sum += weight;
            }
            for (let tap = 0; tap < 64; tap++) kernel[tap] /= sum;
            phases.set(phase, kernel);
          }
          let sample = 0;
          for (let tap = 0; tap < 64; tap++) {
            const position = center + tap - 31;
            // Zero extension is only the filter's boundary condition. EOF emits
            // floor(input duration * 16 kHz) samples, never a padded tail.
            if (position >= 0 && position < total) sample += retained[position - base] * kernel[tap];
          }
          pcm[i] = Math.max(-1, Math.min(1, sample));
        }
        const startMs = outputSamples / 16;
        outputSamples += count;
        const endMs = outputSamples / 16;
        const keepFrom = Math.max(0, Math.floor(outputSamples * rate / 16000) - (rate === 16000 ? 0 : 31));
        retained = retained.slice(keepFrom - base); base = keepFrom;
        return { identity: { ...selected }, scope: "selected-video", sequence: sequence++,
          audioRange: { startMs: first.audioRange.startMs + startMs, endMs: first.audioRange.startMs + endMs },
          capture: { clockId: first.capture.clockId, startMs: first.capture.startMs + startMs, endMs: first.capture.startMs + endMs },
          sampleRate: 16000, channels: 1, sampleFormat: "pcm-f32le", pcm: pcm.buffer };
      }
      return {
        async next(): Promise<IteratorResult<AudioChunk>> {
          if (pending) throw new Error("Audio normalization has one pending read");
          pending = true;
          try {
            while (!closed) {
              const chunk = render();
              if (chunk) return { done: false, value: chunk };
              if (ended) { await close(); break; }
              const next = await input.next();
              if (closed) break;
              if (next.done) ended = true;
              else append(next.value);
            }
            return { done: true, value: undefined };
          } catch (error) { await close(); throw error; }
          finally { pending = false; }
        },
        async return() { await close(); return { done: true as const, value: undefined }; },
      };
    },
  };
}
