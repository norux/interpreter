import type { AudioChunk, SessionIdentity, SessionStatus, SpeechRecognizer, TranscriptRevision } from "../contracts";
import { validAudio } from "../core/audio-queue";
import { sameIdentity } from "../core/identity";
import type { createAsrHost } from "./asr-host";
import type { AsrJob } from "./asr-protocol";

// Experimental 16 kHz profile: energy gating, 20 ms frames, 500 ms silence
// endpoint, speech-band pause cuts after 10 s, 20 s maximum segment with
// 10 s queue headroom during inference. Pause detection never filters ASR PCM.
// This is not a learned speech detector.
export function createSpeechRecognizer(identity: SessionIdentity, language: "ja" | "en",
  executor: Pick<ReturnType<typeof createAsrHost>, "recognize" | "stop">,
  receive: (status: SessionStatus) => void): SpeechRecognizer {
  const selected = { ...identity };
  let started = false;
  let stopped = false;
  let error: Error | undefined;
  let wake: (() => void) | undefined;
  let input: AsyncIterator<AudioChunk> | undefined;
  let bufferedSamples = 0;
  let droppedAudioMs = 0;
  const results: TranscriptRevision[] = [];

  function report(state: SessionStatus["state"], reason?: SessionStatus["reason"]) {
    receive({ identity: { ...selected }, state, reason,
      message: reason ?? state, queue: { pendingAudioMs: bufferedSamples / 16, droppedAudioMs } });
  }
  function stop(reason?: SessionStatus["reason"]) {
    if (stopped) return;
    stopped = true;
    if (reason) error = new Error(reason);
    droppedAudioMs += bufferedSamples / 16; bufferedSamples = 0;
    results.length = 0; executor.stop();
    const stream = input; input = undefined;
    void stream?.return?.().catch(() => {});
    report(reason === "cancelled" || !reason ? "stopping" : "failed", reason);
    wake?.();
  }

  return {
    async *run(audio) {
      if (started || stopped) throw new Error("Speech recognizer requires a fresh session");
      started = true; input = audio[Symbol.asyncIterator]();
      const jobs: AsrJob[] = [];
      let active = false;
      let ended = false;
      let sequence: number | undefined;
      let endMs: number | undefined;
      let clockId: string | undefined;
      let captureEndMs: number | undefined;
      let utterance = 0;
      let segment = new Float32Array(16000 * 20);
      let segmentLength = 0;
      let segmentStartMs = 0;
      let quietSamples = 0;
      let boundaryQuietSamples = 0;
      let continueSegment = false;
      const filterAlpha = 1 - Math.exp(-2 * Math.PI * 2000 / 16000);
      let filterFirst = 0;
      let filterSecond = 0;
      const frame = new Float32Array(320);
      let frameLength = 0;
      let frameStartMs = 0;

      async function drain() {
        if (active || stopped) return;
        active = true;
        try {
          while (jobs.length && !stopped) {
            const job = jobs.shift() as AsrJob;
            const samples = job.pcm.length;
            const output = await executor.recognize(job);
            if (stopped) return;
            bufferedSamples -= samples;
            if (results.length >= 2) { stop("overloaded"); return; }
            results.push(output.revision); report("running"); wake?.();
          }
        } catch (failure) {
          if (!stopped) stop(failure instanceof Error && failure.message === "gpu-lost" ? "gpu-lost" : "engine-failed");
        } finally { active = false; wake?.(); }
      }
      function finishSegment(continuous = false) {
        if (stopped || !segmentLength) return;
        if (segmentLength < 1600) {
          // Less than the executor's 100 ms minimum: no padded/fabricated audio.
          droppedAudioMs += segmentLength / 16; bufferedSamples -= segmentLength;
        } else {
          if (jobs.length >= 2) { stop("overloaded"); return; }
          jobs.push({ identity: { ...selected }, language, utteranceId: `speech-${++utterance}`,
            audioRange: { startMs: segmentStartMs, endMs: segmentStartMs + segmentLength / 16 },
            pcm: segment.slice(0, segmentLength) });
          void drain();
        }
        segmentLength = 0; quietSamples = 0; boundaryQuietSamples = 0;
        continueSegment = continuous;
      }
      function consumeFrame() {
        let energy = 0;
        let boundaryEnergy = 0;
        for (let i = 0; i < frameLength; i++) {
          energy += frame[i] * frame[i];
          // Two 2 kHz one-pole stages keep high-frequency tones from hiding
          // pauses when choosing an earlier boundary for a long segment.
          filterFirst += filterAlpha * (frame[i] - filterFirst);
          filterSecond += filterAlpha * (filterFirst - filterSecond);
          boundaryEnergy += filterSecond * filterSecond;
        }
        const speech = Math.sqrt(energy / frameLength) >= 0.01;
        if (speech || segmentLength || continueSegment) {
          if (!segmentLength) segmentStartMs = frameStartMs;
          segment.set(frame.subarray(0, frameLength), segmentLength);
          segmentLength += frameLength;
          quietSamples = speech ? 0 : quietSamples + frameLength;
          boundaryQuietSamples = Math.sqrt(boundaryEnergy / frameLength) >= 0.01 ? 0 : boundaryQuietSamples + frameLength;
          if (bufferedSamples > 16000 * 30) { stop("overloaded"); return; }
          if (quietSamples >= 8000) finishSegment();
          else if (segmentLength === segment.length || (segmentLength >= 16000 * 10 && boundaryQuietSamples >= 3200)) finishSegment(true);
        } else bufferedSamples -= frameLength;
        frameLength = 0;
      }
      async function ingest() {
        try {
          while (!stopped) {
            const next = await input?.next();
            if (stopped) return;
            if (!next || next.done) break;
            const chunk = next.value;
            if (!sameIdentity(selected, chunk.identity)) { stop("audio-gap"); return; }
            if (!validAudio(chunk) || chunk.scope !== "selected-video" || chunk.sampleRate !== 16000
              || chunk.channels !== 1 || chunk.sampleFormat !== "pcm-f32le" || !(chunk.pcm instanceof ArrayBuffer) || chunk.pcm.byteLength > 12800) {
              stop("engine-failed"); return;
            }
            const pcm = new Float32Array(chunk.pcm);
            if (!pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)) { stop("engine-failed"); return; }
            if (sequence !== undefined && (chunk.sequence !== sequence + 1 || Math.abs(chunk.audioRange.startMs - (endMs as number)) > 0.001
              || chunk.capture.clockId !== clockId || Math.abs(chunk.capture.startMs - (captureEndMs as number)) > 0.001)) {
              // A gap invalidates all affected context; never concatenate across it.
              stop("audio-gap"); return;
            }
            sequence = chunk.sequence; endMs = chunk.audioRange.endMs;
            clockId = chunk.capture.clockId; captureEndMs = chunk.capture.endMs;
            bufferedSamples += pcm.length;
            if (bufferedSamples > 16000 * 30) { stop("overloaded"); return; }
            for (let offset = 0; offset < pcm.length && !stopped;) {
              if (!frameLength) frameStartMs = chunk.audioRange.startMs + offset / 16;
              const count = Math.min(320 - frameLength, pcm.length - offset);
              frame.set(pcm.subarray(offset, offset + count), frameLength);
              frameLength += count; offset += count;
              if (frameLength === 320) consumeFrame();
            }
            if (!stopped) report("running");
          }
          if (!stopped) {
            if (frameLength) consumeFrame();
            finishSegment(); ended = true; wake?.();
          }
        } catch (failure) {
          if (!stopped) stop(failure instanceof Error && failure.message === "audio-gap" ? "audio-gap" : "engine-failed");
        }
      }
      report("running"); void ingest();
      try {
        while (!stopped) {
          const result = results.shift();
          if (result) { yield result; continue; }
          if (ended && !active && !jobs.length) break;
          await new Promise<void>(resolve => { wake = resolve; });
          wake = undefined;
        }
        if (error) throw error;
      } finally {
        stop(); jobs.length = 0; segment = new Float32Array(0);
      }
    },
    async cancel(current) { if (sameIdentity(selected, current)) stop("cancelled"); },
    async close() { stop(); },
  };
}
