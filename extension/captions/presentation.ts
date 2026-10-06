import type { CaptionRevision, MediaTargetId, PresentationEvent } from "../../packages/contracts";
import { createPresentationPolicy } from "../../packages/core/presentation-policy";
import type { Caption } from "./contracts";

// Presentation compatibility only. C4 owns engine normalization and capabilities.
// This sentinel is a legacy tab output, never a selected-video media handle.
export function createLegacyPresentation(sessionId: string, present: (event: PresentationEvent) => void) {
  const identity = { sessionId, targetId: "legacy-tab-output" as MediaTargetId, epoch: 0 };
  const policy = createPresentationPolicy(identity, {
    now: () => performance.now(),
    schedule(callback, delayMs) {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  }, present);
  return {
    caption(caption: Caption) {
      if (caption.sessionId !== sessionId) return;
      policy.accept({ type: "paired-caption", caption: {
        source: { identity, utteranceId: caption.utteranceId, sourceRevision: caption.revision,
          text: caption.source, final: caption.final, language: "und",
          audioRange: { startMs: caption.audioStartMs, endMs: caption.audioEndMs } },
        translation: { state: "paired", revision: { identity, utteranceId: caption.utteranceId,
          sourceRevision: caption.revision, translationRevision: caption.revision,
          languages: { source: "und", target: "ko" }, text: caption.translation, final: caption.final } },
      } });
    },
    progress: policy.progress,
    retire: policy.retire,
    clear: policy.clear,
    dispose: policy.dispose,
  };
}

export function displayCaption(caption: CaptionRevision): Omit<Caption, "emittedAtMs"> {
  return {
    sessionId: caption.source.identity.sessionId, utteranceId: caption.source.utteranceId,
    revision: caption.translation.state === "paired" ? caption.translation.revision.translationRevision : caption.source.sourceRevision,
    source: caption.source.text,
    translation: caption.translation.state === "paired" ? caption.translation.revision.text : "",
    final: caption.source.final && caption.translation.state === "paired" && caption.translation.revision.final,
    audioStartMs: caption.source.audioRange.startMs, audioEndMs: caption.source.audioRange.endMs,
  };
}
