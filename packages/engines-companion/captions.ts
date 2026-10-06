import type { CaptionRevision, LanguagePair, SessionIdentity } from "../contracts";

// The server's single revision counts paired emissions, not internal ASR updates.
export interface CompanionCaption {
  sessionId: string;
  utteranceId: string;
  revision: number;
  source: string;
  translation: string;
  final: boolean;
  audioStartMs: number;
  audioEndMs: number;
  emittedAtMs: number;
}

export function createCompanionCaptionBridge(identity: SessionIdentity, languages: LanguagePair, wireSessionId = identity.sessionId) {
  const session = { ...identity };
  const pair = { ...languages };
  const records = new Map<string, CaptionRevision>();
  let retiredThroughMs = -1;
  return {
    accept(value: unknown): CaptionRevision | undefined {
      if (!value || typeof value !== "object") return;
      const caption = value as CompanionCaption;
      if (caption.sessionId !== wireSessionId || typeof caption.utteranceId !== "string" || !caption.utteranceId
        || !Number.isSafeInteger(caption.revision) || caption.revision <= 0
        || typeof caption.source !== "string" || typeof caption.translation !== "string" || typeof caption.final !== "boolean"
        || !Number.isFinite(caption.audioStartMs) || caption.audioStartMs < 0
        || !Number.isFinite(caption.audioEndMs) || caption.audioEndMs < caption.audioStartMs
        || !Number.isFinite(caption.emittedAtMs)) return;
      const previous = records.get(caption.utteranceId);
      if (previous?.translation.state === "paired"
        && (previous.translation.revision.translationRevision >= caption.revision || (previous.source.final && !caption.final))) return;
      if (!previous && caption.audioStartMs <= retiredThroughMs) return;
      const changed = !previous || previous.source.text !== caption.source || previous.source.final !== caption.final
        || previous.source.audioRange.startMs !== caption.audioStartMs || previous.source.audioRange.endMs !== caption.audioEndMs;
      const sourceRevision = (previous?.source.sourceRevision ?? 0) + (changed ? 1 : 0);
      const normalized: CaptionRevision = {
        source: { identity: { ...session }, utteranceId: caption.utteranceId, sourceRevision,
          text: caption.source, final: caption.final, language: pair.source,
          audioRange: { startMs: caption.audioStartMs, endMs: caption.audioEndMs } },
        translation: { state: "paired", revision: { identity: { ...session }, utteranceId: caption.utteranceId,
          sourceRevision, translationRevision: caption.revision, languages: { ...pair }, text: caption.translation, final: caption.final } },
      };
      records.set(caption.utteranceId, normalized);
      if (records.size > 300) {
        const oldest = records.entries().next().value;
        if (oldest) { retiredThroughMs = Math.max(retiredThroughMs, oldest[1].source.audioRange.startMs); records.delete(oldest[0]); }
      }
      return normalized;
    },
  };
}
