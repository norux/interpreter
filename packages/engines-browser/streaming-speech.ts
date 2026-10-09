import type { AudioChunk, SessionIdentity, SessionStatus, SpeechRecognizer, TranscriptRevision } from "../contracts";
import { validAudio } from "../core/audio-queue";
import { sameIdentity } from "../core/identity";
import type { createAsrHost } from "./asr-host";
import type { AsrSegment } from "./asr-protocol";

// Whisper decodes growing audio snapshots. Only text agreed by two successive
// snapshots is committed; a decoder's provisional full stop is not sufficient.
export function createStreamingSpeechRecognizer(identity: SessionIdentity, language: "ja" | "en" | "ko" | "auto",
  executor: Pick<ReturnType<typeof createAsrHost>, "recognize" | "stop">,
  receive: (status: SessionStatus) => void,
  detector: { detect(pcm: Float32Array): Promise<{ speech: boolean }>; stop(): void }): SpeechRecognizer {
  const selected = { ...identity };
  let detectedLanguage: "en" | "ja" | "ko" = language === "auto" ? "en" : language;
  const splitters = { en: new Intl.Segmenter("en", { granularity: "sentence" }),
    ja: new Intl.Segmenter("ja", { granularity: "sentence" }), ko: new Intl.Segmenter("ko", { granularity: "sentence" }) };
  const boundaries: number[] = [];
  let lastBoundarySpeechEndMs = -1;
  let started = false; let stopped = false; let ended = false; let active = false;
  let failure: Error | undefined;
  let input: AsyncIterator<AudioChunk> | undefined;
  let wake: (() => void) | undefined;
  const results: TranscriptRevision[] = [];
  let buffer = new Float32Array(16000 * 22); // 12 s snapshot + 10 s inference headroom.
  let length = 0; let startMs = 0; let endMs = 0;
  let speechEndMs = -1; let quietSamples = 0;
  let decodedEndMs = -1; let pauseDecodedEndMs = -1; let decodedQuietSamples = 0;
  let previous = ""; let previousEndings = new Set<number>(); let committed = 0; let utterance = 0; let droppedMs = 0;

  function normalized(text: string) {
    return text.normalize("NFKC").toLowerCase().replace(/\p{P}/gu, "")
      .replace(/\s+/gu, detectedLanguage === "ja" ? "" : " ").trim();
  }
  function complete(text: string) {
    const trimmed = text.trim().replace(/["'”’」』）)]*$/u, "");
    if (detectedLanguage === "ja") return /[。！？!?]$/u.test(trimmed)
      || /(?:ませんでした|ません|ました|ます|でした|です|ましょう|ください|でしょう|だった|大丈夫|(?:る|た|だ|ない|ます|です|て|で|く|いい)[よね]|んだ|んだけど|かな|しよう)$/u.test(trimmed);
    if (detectedLanguage === "ko") return /[.!?。！？]$/u.test(trimmed);
    if (/[!?]$/u.test(trimmed)) return true;
    const clause = /[,;:]$/u.test(trimmed) && (/^\s*let['’]s\b/iu.test(trimmed) || /\b(?:am|is|are|was|were|have|has|had|do|does|did|will|would|can|could|must|should|may|might|shall|[a-z]+ed)\b/iu.test(trimmed));
    return (/\.$/u.test(trimmed) || clause) && !/\b(?:mr|mrs|ms|dr|prof|st|vs|etc|e\.g|i\.e|[a-z]|and|but|because|if|when|that|to|the|of|for|with|at|in)[.,;:]$/iu.test(trimmed);
  }
  function sentences(text: string) {
    return detectedLanguage === "ja" ? text.split(/(?<=[。！？!?])\s*|(?<=ませんでした|ません|ました|ます|でした|です|ましょう|ください)\s*(?=[\p{Script=Han}\p{Script=Katakana}])/u)
      : [...splitters[detectedLanguage].segment(text)].flatMap(sentence => sentence.segment.split(
        /(?<=[,;:])\s+(?=(?:let['’]s|please|i|we|you|he|she|they|it|this|that|there)\b)/iu,
      ));
  }
  function report(state: SessionStatus["state"], reason?: SessionStatus["reason"]) {
    receive({ identity: selected, state, reason, message: reason ?? state,
      queue: { pendingAudioMs: length / 16, droppedAudioMs: droppedMs } });
  }
  function stop(reason?: SessionStatus["reason"]) {
    if (stopped) return;
    stopped = true; if (reason) failure = new Error(reason);
    if (speechEndMs > startMs) droppedMs += length / 16;
    length = 0; results.length = 0;
    executor.stop(); detector.stop();
    void input?.return?.().catch(() => {}); input = undefined;
    report(reason && reason !== "cancelled" ? "failed" : "stopping", reason); wake?.();
  }
  function trim(samples: number) {
    buffer.copyWithin(0, samples, length); length -= samples; startMs += samples / 16;
    previous = ""; previousEndings.clear(); committed = 0;
    while (boundaries.length && boundaries[0] <= startMs) boundaries.shift();
  }
  function publish(text: string, range: { startMs: number; endMs: number }) {
    if (!text.trim()) return;
    if (results.length >= 16) { stop("overloaded"); return; }
    results.push({ identity: selected, utteranceId: `speech-${++utterance}`, language: detectedLanguage,
      sourceRevision: 1, final: true, text: text.trim(), audioRange: range }); wake?.();
  }
  function accept(segments: readonly AsrSegment[], decodedStartMs: number, analyzedEndMs: number, final: boolean, finishUtterance: boolean) {
    const text = segments.map(segment => segment.text).join("");
    const current = normalized(text);
    const endings = new Set<number>();
    let endingPrefix = ""; let endingSentence = "";
    for (const segment of segments) for (const sentence of sentences(segment.text)) {
      endingPrefix += sentence; endingSentence += sentence;
      if (complete(endingSentence)) { endings.add(normalized(endingPrefix).length); endingSentence = ""; }
    }
    let stable = 0;
    while (stable < previous.length && stable < current.length && previous[stable] === current[stable]) stable++;
    let prefix = ""; let pending = ""; let pendingStartMs: number | undefined;
    let trimEndMs = decodedStartMs;
    for (const segment of segments) {
      // A timestamp segment may contain multiple sentences; they share its
      // coarse acoustic range rather than inventing word-level timestamps.
      for (const sentence of sentences(segment.text)) {
        const sentenceStart = normalized(prefix).length;
        prefix += sentence;
        const position = normalized(prefix).length;
        if (position <= committed) continue;
        let offset = 0;
        // A punctuation correction can merge a committed sentence with its
        // unfinished successor inside the same retained acoustic segment.
        while (offset < sentence.length && normalized(sentence.slice(0, offset)).length < committed - sentenceStart) offset++;
        pending += offset ? sentence.slice(offset).replace(/^[\s。、！？!?,]+/u, "") : sentence;
        pendingStartMs ??= decodedStartMs + segment.startMs;
        const behindLiveEdge = decodedStartMs + segment.endMs <= analyzedEndMs - 320;
        const followingWords = normalized(text.slice(prefix.length)).length > 0;
        const pause = quietSamples >= 3840 && speechEndMs <= analyzedEndMs - 80;
        if (complete(pending) && (final || position <= stable && previousEndings.has(position) && (followingWords || behindLiveEdge || pause))) {
          publish(pending, { startMs: pendingStartMs, endMs: decodedStartMs + segment.endMs });
          committed = position; pending = ""; pendingStartMs = undefined;
        }
        if (stopped) return;
      }
      if (normalized(prefix).length <= committed) trimEndMs = decodedStartMs + segment.endMs;
    }
    previous = current; previousEndings = endings;
    // Timestamp segments are acoustic ranges, not sentences. Join their
    // unfinished text and retain a trailing phrase across the snapshot limit.
    // EOF (or a window with no usable sentence boundary) still drains once.
    const settledPause = current.length <= stable && quietSamples >= 25600 && speechEndMs <= analyzedEndMs - 1000;
    if (pending && (settledPause || final && (finishUtterance || trimEndMs <= decodedStartMs))) {
      publish(pending, { startMs: pendingStartMs ?? decodedStartMs, endMs: analyzedEndMs });
      committed = current.length; pending = "";
    }
    if ((final || settledPause) && !pending) trimEndMs = analyzedEndMs;
    // Once the entire decoded speech is confirmed during silence, discard its
    // decoded quiet tail too; it cannot start another noise-only ASR job.
    if (committed === current.length && speechEndMs <= analyzedEndMs - 240 && quietSamples >= 3840) trimEndMs = analyzedEndMs;
    const samples = Math.min(length, Math.max(0, Math.round((trimEndMs - startMs) * 16)));
    if (samples) trim(samples);
  }
  function due() {
    return length >= 1600 && speechEndMs > startMs && (boundaries.length > 0 || ended || length >= 16000 * 12
      || length >= 16000 && (endMs - decodedEndMs >= 1000
        || quietSamples >= 3840 && endMs - pauseDecodedEndMs >= 1000
        || quietSamples >= 25600 && decodedQuietSamples < 25600));
  }
  async function decode() {
    if (active || stopped || !due()) return;
    active = true;
    const decodedStartMs = startMs;
    const boundary = boundaries[0];
    const samples = Math.min(length, 16000 * 12, boundary === undefined ? Infinity : Math.round((boundary - startMs) * 16));
    const analyzedEndMs = startMs + samples / 16;
    const finishUtterance = ended || boundary !== undefined && analyzedEndMs >= boundary;
    const final = finishUtterance || samples === 16000 * 12;
    decodedEndMs = analyzedEndMs; decodedQuietSamples = quietSamples;
    if (quietSamples >= 3840) pauseDecodedEndMs = endMs;
    try {
      const output = await executor.recognize({ identity: selected, utteranceId: `snapshot-${++utterance}`, language,
        audioRange: { startMs: decodedStartMs, endMs: analyzedEndMs }, pcm: buffer.slice(0, samples), timestamps: true });
      if (stopped) return;
      if (!output.segments) throw new Error("Missing incremental ASR timestamps");
      if (language === "auto") {
        const nextLanguage = output.revision.language;
        if (nextLanguage !== "en" && nextLanguage !== "ja" && nextLanguage !== "ko") throw new Error("Invalid detected language");
        if (nextLanguage !== detectedLanguage) { previous = ""; previousEndings.clear(); committed = 0; }
        detectedLanguage = nextLanguage;
        // Short uncertain speech needs more evidence before becoming a caption.
        // Its PCM stays in the growing snapshot, including the initial words.
        if (!final && analyzedEndMs - decodedStartMs < 2000 && (output.revision.confidence?.value ?? 0) < 0.65) return;
      }
      accept(output.segments, decodedStartMs, analyzedEndMs, final, finishUtterance);
      report("running");
    } catch (error) {
      if (!stopped) stop(error instanceof Error && error.message === "gpu-lost" ? "gpu-lost" : "engine-failed");
    } finally { active = false; wake?.(); if (!stopped && due()) void decode(); }
  }
  async function ingest() {
    const frame = new Float32Array(512); let frameLength = 0; let frameStartMs = 0;
    let sequence: number | undefined; let scope: AudioChunk["scope"] | undefined;
    let audioEndMs: number | undefined; let captureEndMs: number | undefined; let clockId: string | undefined;
    async function consumeFrame() {
      const detection = await detector.detect(frame.slice(0, frameLength));
      if (stopped) return;
      if (typeof detection.speech !== "boolean") throw new Error("Invalid speech detector result");
      if (length + frameLength > buffer.length) { droppedMs += frameLength / 16; stop("overloaded"); return; }
      if (!length) startMs = frameStartMs;
      buffer.set(frame.subarray(0, frameLength), length); length += frameLength;
      endMs = frameStartMs + frameLength / 16;
      if (detection.speech) { speechEndMs = endMs; quietSamples = 0; } else quietSamples += frameLength;
      if (language === "auto" && quietSamples >= 3840 && speechEndMs > startMs && speechEndMs !== lastBoundarySpeechEndMs) {
        if (boundaries.length >= 16) { stop("overloaded"); return; }
        boundaries.push(speechEndMs + 240); lastBoundarySpeechEndMs = speechEndMs;
      }
      // Keep onset context until learned admission, without decoding noise.
      if (speechEndMs <= startMs && length >= 16000 * 12) trim(length - 4096);
      void decode(); frameLength = 0;
    }
    try {
      while (!stopped) {
        const next = await input?.next(); if (stopped) return;
        if (!next || next.done) break;
        const chunk = next.value;
        if (!sameIdentity(selected, chunk.identity)) { stop("audio-gap"); return; }
        if (!validAudio(chunk) || !["tab-mix", "selected-video"].includes(chunk.scope) || chunk.sampleRate !== 16000
          || chunk.channels !== 1 || chunk.sampleFormat !== "pcm-f32le" || !(chunk.pcm instanceof ArrayBuffer)
          || chunk.pcm.byteLength > 12800) { stop("engine-failed"); return; }
        if (sequence !== undefined && (chunk.sequence !== sequence + 1 || chunk.scope !== scope
          || Math.abs(chunk.audioRange.startMs - (audioEndMs as number)) > 0.001 || chunk.capture.clockId !== clockId
          || Math.abs(chunk.capture.startMs - (captureEndMs as number)) > 0.001)) { stop("audio-gap"); return; }
        const pcm = new Float32Array(chunk.pcm);
        if (!pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)) { stop("engine-failed"); return; }
        sequence = chunk.sequence; scope = chunk.scope; audioEndMs = chunk.audioRange.endMs;
        clockId = chunk.capture.clockId; captureEndMs = chunk.capture.endMs;
        for (let offset = 0; offset < pcm.length && !stopped;) {
          if (!frameLength) frameStartMs = chunk.audioRange.startMs + offset / 16;
          const count = Math.min(512 - frameLength, pcm.length - offset);
          frame.set(pcm.subarray(offset, offset + count), frameLength); frameLength += count; offset += count;
          if (frameLength === 512) await consumeFrame();
        }
        if (!stopped) report("running");
      }
      if (!stopped) { if (frameLength) await consumeFrame(); ended = true; void decode(); wake?.(); }
    } catch (error) { if (!stopped) stop(error instanceof Error && error.message === "audio-gap" ? "audio-gap" : "engine-failed"); }
  }
  return {
    async *run(audio) {
      if (started || stopped) throw new Error("Streaming recognizer requires a fresh session");
      started = true; input = audio[Symbol.asyncIterator](); report("running"); void ingest();
      try {
        while (!stopped) {
          const result = results.shift(); if (result) { yield result; continue; }
          if (ended && !active && !due()) break;
          await new Promise<void>(resolve => { wake = resolve; }); wake = undefined;
        }
        if (failure) throw failure;
      } finally { stop(); buffer = new Float32Array(0); }
    },
    async cancel(current) { if (sameIdentity(selected, current)) stop("cancelled"); },
    async close() { stop(); },
  };
}
