import type { AudioChunk, TranscriptRevision } from "../contracts";

// Session-local voice embeddings only: labels are anonymous and never reused
// across sessions. Inference runs beside ASR rather than delaying its stream.
export function createSpeakerTracker(embed: (pcm: Float32Array) => Promise<Float32Array>,
  receive: (utteranceId: string, speakerId: number) => void, fail: (error: unknown) => void) {
  const voices: { center: Float32Array; count: number }[] = [];
  const windows: { startMs: number; endMs: number; speakerId: number }[] = [];
  const sources = new Map<string, TranscriptRevision>();
  const assigned = new Set<string>();
  let pcm = new Float32Array(48000);
  let length = 0; let endMs = 0; let submittedEndMs = -1000;
  let quietMs = 0;
  let active: Promise<void> | undefined;
  let stopped = false;

  function label(embedding: Float32Array) {
    const norm = Math.hypot(...embedding);
    if (!Number.isFinite(norm) || norm < 1e-8) throw new Error("Invalid voice embedding");
    const normalized = embedding.map(value => value / norm);
    let best = -1; let similarity = -1;
    for (const [index, voice] of voices.entries()) {
      const score = normalized.reduce((sum, value, i) => sum + value * voice.center[i], 0);
      if (score > similarity) { best = index; similarity = score; }
    }
    // Cosine threshold is qualified on the fixture, not a claimed universal DER.
    if (similarity < 0.65) {
      if (voices.length >= 8) return undefined;
      voices.push({ center: normalized, count: 1 }); return voices.length;
    }
    const voice = voices[best];
    if (similarity >= 0.75) {
      const weight = Math.min(voice.count, 20);
      const center = voice.center.map((value, i) => value * weight + normalized[i]);
      const scale = Math.hypot(...center);
      voice.center = center.map(value => value / scale); voice.count++;
    }
    return best + 1;
  }
  function assign(source: TranscriptRevision) {
    if (assigned.has(source.utteranceId)) return;
    const candidates = windows.filter(window => window.startMs >= source.audioRange.startMs - 250
      && window.endMs <= source.audioRange.endMs + 500);
    // Native ASR ranges are delivery times; the most recent window matches its
    // newly emitted phrase better than averaging the whole cumulative result.
    const window = candidates.at(-1);
    if (!window) return;
    assigned.add(source.utteranceId); receive(source.utteranceId, window.speakerId);
  }
  function submit() {
    if (stopped || active || length < 32000 || endMs - submittedEndMs < 1000) return;
    const samples = pcm.slice(Math.max(0, length - 32000), length);
    let voiced = 0;
    for (let offset = 0; offset < samples.length; offset += 320) {
      const frame = samples.subarray(offset, offset + 320);
      if (Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length) >= 0.006) voiced += frame.length;
    }
    submittedEndMs = endMs;
    if (voiced < 16000) return;
    const range = { startMs: endMs - samples.length / 16, endMs };
    active = (async () => {
      try {
        const embedding = await embed(samples);
        if (stopped) return;
        const speakerId = label(embedding);
        if (speakerId !== undefined) {
          windows.push({ ...range, speakerId });
          if (windows.length > 60) windows.shift();
          for (const source of sources.values()) assign(source);
        }
      } catch (error) { if (!stopped) { stopped = true; fail(error); } }
      finally { active = undefined; }
    })();
  }
  return {
    push(chunk: AudioChunk) {
      if (stopped) return;
      const samples = new Float32Array(chunk.pcm);
      if (endMs && Math.abs(chunk.audioRange.startMs - endMs) > 0.001) throw new Error("audio-gap");
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      if (rms < 0.006) quietMs += chunk.audioRange.endMs - chunk.audioRange.startMs;
      else {
        // Never enroll a blend of voices across the same measured turn pause.
        if (quietMs >= 320) length = 0;
        quietMs = 0;
      }
      const discard = Math.max(0, length + samples.length - pcm.length);
      if (discard) { pcm.copyWithin(0, discard, length); length -= discard; }
      pcm.set(samples, length); length += samples.length; endMs = chunk.audioRange.endMs;
      submit();
    },
    observe(source: TranscriptRevision) {
      if (stopped) return;
      sources.set(source.utteranceId, source); assign(source);
      if (sources.size > 300) { const id = sources.keys().next().value as string; sources.delete(id); assigned.delete(id); }
    },
    async settle() { await active; },
    stop() { stopped = true; pcm = new Float32Array(0); sources.clear(); assigned.clear(); windows.length = 0; voices.length = 0; },
  };
}
