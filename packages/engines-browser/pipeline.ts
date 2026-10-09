import type { InterpretationEngine, InterpretationEvent, LanguagePair, ReasonCode, SessionIdentity, SessionStatus, SpeechRecognizer, TextTranslator } from "../contracts";
import { sameIdentity } from "../core/identity";
import { normalizeSelectedAudio } from "./normalize-audio";
import { createSpeakerTracker } from "./speaker-tracker";
import { createTranslationQueue } from "./translation-queue";

// Prepared document resources stay in the Chrome host; this stream owns one epoch.
export function createBrowserPipeline(identity: SessionIdentity, languages: LanguagePair,
  createRecognizer: (receive: (status: SessionStatus) => void) => SpeechRecognizer,
  translator: TextTranslator, speaker?: { embed(pcm: Float32Array): Promise<Float32Array>; fail(error: unknown): void }): Pick<InterpretationEngine, "run" | "cancel" | "close"> {
  const selected = { ...identity };
  const events: InterpretationEvent[] = [];
  let status: InterpretationEvent | undefined;
  let wake: (() => void) | undefined;
  let stopped = false;
  let started = false;
  let closed = false;
  let ended = false;
  let failure: Error | undefined;
  const recognizer = createRecognizer(value => {
    if (!stopped && sameIdentity(selected, value.identity)) {
      status = { type: "status", status: value }; wake?.();
    }
  });

  function fail(reason: string) {
    if (stopped) return;
    failure = new Error(reason);
    void cancel();
  }
  // Native speech can finalize all 16 retained results in one callback.
  const translations = createTranslationQueue(selected, languages, translator, 16, 300, caption => {
    if (stopped) return;
    // Caption events are never replaced by high-frequency queue telemetry.
    if (events.length >= 16) { fail("overloaded"); return; }
    events.push(caption.translation.state === "pending" ? { type: "transcript", revision: caption.source }
      : { type: "translation", revision: caption.translation.revision }); wake?.();
  }, fail);

  const voices = speaker ? createSpeakerTracker(speaker.embed, (utteranceId, speakerId) => {
    if (stopped) return;
    events.push({ type: "speaker", identity: selected, utteranceId, speakerId }); wake?.();
  }, speaker.fail) : undefined;
  async function* trackedAudio(audio: Parameters<SpeechRecognizer["run"]>[0]) {
    for await (const chunk of normalizeSelectedAudio(selected, audio)) { voices?.push(chunk); yield chunk; }
  }

  let cleanup: Promise<void> | undefined;
  function cancel(): Promise<void> {
    if (cleanup) return cleanup;
    stopped = true; voices?.stop(); events.length = 0; status = undefined; wake?.();
    cleanup = Promise.all([translations.cancel(), recognizer.cancel(selected)]).then(() => {});
    // A failed stream reports its error through run, including during cleanup.
    void cleanup.catch(() => {});
    return cleanup;
  }

  return {
    async *run(audio) {
      if (started || stopped) throw new Error("Browser pipeline requires a fresh epoch");
      started = true;
      const consume = async () => {
        try {
          for await (const source of recognizer.run(trackedAudio(audio))) {
            if (stopped) return;
            if (!sameIdentity(selected, source.identity) || (languages.source === "auto"
              ? !["en", "ja", "ko"].includes(source.language) : source.language !== languages.source)) { fail("engine-failed"); return; }
            if (translations.accept(source)) voices?.observe(source);
          }
          await translations.whenIdle();
          await voices?.settle();
          ended = true; wake?.();
        } catch (error) { fail(error instanceof Error ? error.message : "engine-failed"); }
      };
      void consume();
      try {
        while (!stopped) {
          const event = events.shift();
          if (event) { yield event; continue; }
          if (status) { const event = status; status = undefined; yield event; continue; }
          if (ended) break;
          await new Promise<void>(resolve => { wake = resolve; }); wake = undefined;
        }
        if (failure) {
          const reason: ReasonCode = failure.message === "gpu-lost" || failure.message === "audio-gap" || failure.message === "overloaded" ? failure.message : "engine-failed";
          yield { type: "status", status: { identity: selected, state: "failed", reason, message: reason } };
          throw failure;
        }
      } finally { await cancel(); }
    },
    cancel(current) { return sameIdentity(selected, current) ? cancel() : Promise.resolve(); },
    async close() { if (closed) return; closed = true; await cancel(); await recognizer.close(); },
  };
}
