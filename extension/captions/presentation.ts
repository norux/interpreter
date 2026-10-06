import { FRAMEWORK_VERSION, type CaptionRevision, type MediaTargetId, type PresentationEvent } from "../../packages/contracts";
import { createPresentationPolicy } from "../../packages/core/presentation-policy";
import { createCompanionCaptionBridge } from "../../packages/engines-companion/captions";
import type { Caption } from "./contracts";

// Compatibility for legacy messages; live companion messages already carry normalized pairs.
// This sentinel is a legacy tab output, never a selected-video media handle.
export function createLegacyPresentation(sessionId: string, present: (event: PresentationEvent) => void) {
  const identity = { sessionId, targetId: "legacy-tab-output" as MediaTargetId, epoch: 0 };
  const bridge = createCompanionCaptionBridge(identity, { source: "und", target: "ko" });
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
      if (caption.framework && (caption.framework.version !== FRAMEWORK_VERSION || caption.framework.message?.type !== "paired-caption")) return;
      const normalized = caption.framework?.message.type === "paired-caption" ? caption.framework.message.caption : bridge.accept(caption);
      if (normalized) policy.accept({ type: "paired-caption", caption: normalized });
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
