import type { AudioChunk, SessionIdentity, SessionStatus, SpeechRecognizer, TranscriptRevision } from "../contracts";
import { validAudio } from "../core/audio-queue";
import { sameIdentity } from "../core/identity";
import type { createAsrHost } from "./asr-host";
import type { AsrJob } from "./asr-protocol";

// Experimental 16 kHz profiles: energy-only 20 ms frames/500 ms endpoint and
// speech-band pause cuts after 10 s; learned 32 ms frames/500 ms detected pauses,
// shortened to five frames (160 ms) after 6 s for English / 10 s for Japanese
// to avoid forcing a cut through quiet speech whose detected pause can shrink
// by one or two frames.
// Both keep a 20 s maximum segment and 10 s queue headroom during inference.
// Learned short pauses split near their midpoint after 160 ms of sustained
// onset, avoiding cuts on isolated detector hits inside quiet words. After
// 1,500 ms of detected silence, submit without another onset/EOF, retaining
// 256 ms of context for the next segment. The first result can submit after
// 512 ms with speech probability below 0.05 to leave time for decoder warmup;
// later segments retain their onset/EOF policy. Neither path filters ASR samples.
// The original energy-only profile remains a comparison, never a fallback.
export function createSpeechRecognizer(identity: SessionIdentity, language: "ja" | "en",
  executor: Pick<ReturnType<typeof createAsrHost>, "recognize" | "stop">,
  receive: (status: SessionStatus) => void,
  detector?: { detect(pcm: Float32Array): Promise<{ speech: boolean; probability?: number }>; stop(): void }): SpeechRecognizer {
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
    results.length = 0; executor.stop(); detector?.stop();
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
      let scope: AudioChunk["scope"] | undefined;
      let endMs: number | undefined;
      let clockId: string | undefined;
      let captureEndMs: number | undefined;
      let utterance = 0;
      let segment = new Float32Array(16000 * 20);
      let segmentLength = 0;
      let detectedSpeech = false;
      let segmentStartMs = 0;
      let quietSamples = 0;
      let confidentQuietSamples = 0;
      let boundaryQuietSamples = 0;
      let pauseCut: number | undefined;
      let onsetSamples = 0;
      let continueSegment = false;
      const filterAlpha = 1 - Math.exp(-2 * Math.PI * 2000 / 16000);
      let filterFirst = 0;
      let filterSecond = 0;
      const frameSamples = detector ? 512 : 320;
      const frame = new Float32Array(frameSamples);
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
      function finishSegment(continuous = false, length = segmentLength) {
        if (stopped || !segmentLength) return;
        if (detector && !detectedSpeech) {
          // Deliberately rejected speech-free context is not queue loss.
          bufferedSamples -= length;
        } else if (length < 1600) {
          // Less than the executor's 100 ms minimum: no padded/fabricated audio.
          droppedAudioMs += length / 16; bufferedSamples -= length;
        } else {
          if (jobs.length >= 2) { stop("overloaded"); return; }
          jobs.push({ identity: { ...selected }, language, utteranceId: `speech-${++utterance}`,
            audioRange: { startMs: segmentStartMs, endMs: segmentStartMs + length / 16 },
            pcm: segment.slice(0, length) });
          void drain();
        }
        segment.copyWithin(0, length, segmentLength);
        segmentLength -= length; segmentStartMs += length / 16;
        detectedSpeech = false; quietSamples = 0; confidentQuietSamples = 0; boundaryQuietSamples = 0;
        pauseCut = undefined; onsetSamples = 0;
        continueSegment = continuous;
      }
      async function consumeFrame() {
        const detection = detector ? await detector.detect(frame.slice(0, frameLength)) : undefined;
        const activity = detector ? detection?.speech : false;
        if (stopped) return;
        if (typeof activity !== "boolean") throw new Error("Invalid speech detector result");
        if (detector) {
          if (!activity) { pauseCut = undefined; onsetSamples = 0; }
          else {
            if (detectedSpeech && quietSamples >= (segmentLength >= 16000 * (language === "en" ? 6 : 10) ? 2560 : 8000)) {
              pauseCut = segmentLength - Math.floor(quietSamples / (2 * frameSamples)) * frameSamples;
            }
            if (pauseCut !== undefined) {
              onsetSamples += frameLength;
              if (onsetSamples >= 2560) {
                finishSegment(true, pauseCut);
                if (stopped) return;
              }
            }
          }
        }
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
        // Learned admission can arrive after quiet initial words. Retain their
        // context at lower energy; only the detector can admit it to ASR.
        const speech = Math.sqrt(energy / frameLength) >= (detector ? 0.001 : 0.01);
        if (speech || activity || segmentLength || continueSegment) {
          detectedSpeech ||= activity;
          if (!segmentLength) segmentStartMs = frameStartMs;
          segment.set(frame.subarray(0, frameLength), segmentLength);
          segmentLength += frameLength;
          quietSamples = (detector ? activity : speech) ? 0 : quietSamples + frameLength;
          confidentQuietSamples = !activity && detection?.probability !== undefined && detection.probability < 0.05
            ? confidentQuietSamples + frameLength : 0;
          boundaryQuietSamples = Math.sqrt(boundaryEnergy / frameLength) >= 0.01 ? 0 : boundaryQuietSamples + frameLength;
          if (bufferedSamples > 16000 * 30) { stop("overloaded"); return; }
          if (detector && detectedSpeech && (quietSamples >= 24000 || (utterance === 0 && confidentQuietSamples >= 8192))) finishSegment(true, segmentLength - 4096);
          else if (!detector && quietSamples >= 8000) finishSegment();
          else if (segmentLength === segment.length || (!detector && segmentLength >= 16000 * 10 && boundaryQuietSamples >= 3200)) finishSegment(true);
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
            if (!validAudio(chunk) || !["selected-video", "tab-mix"].includes(chunk.scope) || chunk.sampleRate !== 16000
              || chunk.channels !== 1 || chunk.sampleFormat !== "pcm-f32le" || !(chunk.pcm instanceof ArrayBuffer) || chunk.pcm.byteLength > 12800) {
              stop("engine-failed"); return;
            }
            const pcm = new Float32Array(chunk.pcm);
            if (!pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)) { stop("engine-failed"); return; }
            if (sequence !== undefined && (chunk.sequence !== sequence + 1 || chunk.scope !== scope || Math.abs(chunk.audioRange.startMs - (endMs as number)) > 0.001
              || chunk.capture.clockId !== clockId || Math.abs(chunk.capture.startMs - (captureEndMs as number)) > 0.001)) {
              // A gap invalidates all affected context; never concatenate across it.
              stop("audio-gap"); return;
            }
            scope = chunk.scope; sequence = chunk.sequence; endMs = chunk.audioRange.endMs;
            clockId = chunk.capture.clockId; captureEndMs = chunk.capture.endMs;
            bufferedSamples += pcm.length;
            if (bufferedSamples > 16000 * 30) { stop("overloaded"); return; }
            for (let offset = 0; offset < pcm.length && !stopped;) {
              if (!frameLength) frameStartMs = chunk.audioRange.startMs + offset / 16;
              const count = Math.min(frameSamples - frameLength, pcm.length - offset);
              frame.set(pcm.subarray(offset, offset + count), frameLength);
              frameLength += count; offset += count;
              if (frameLength === frameSamples) await consumeFrame();
            }
            if (!stopped) report("running");
          }
          if (!stopped) {
            if (frameLength) await consumeFrame();
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
