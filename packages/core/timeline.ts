import type { AudioChunk, AudioRange, PlaybackAnchor, PlaybackEvent, SessionIdentity } from "../contracts";
import { validAudio } from "./audio-queue";
import { sameIdentity } from "./identity";

function validAnchor(anchor: PlaybackAnchor): boolean {
  return anchor.clockId.length > 0 && Number.isFinite(anchor.monotonicMs)
    && Number.isFinite(anchor.mediaTimeMs) && anchor.mediaTimeMs >= 0
    && Number.isFinite(anchor.playbackRate) && anchor.playbackRate > 0;
}

export function createTimeline(initial: SessionIdentity) {
  let identity = initial;
  let anchor: PlaybackAnchor | undefined;
  let originMs: number | undefined;
  let clockId: string | undefined;
  let sequence = -1;
  let playbackSequence = -1;
  let audioEndMs = 0;

  return {
    get identity() { return identity; },
    get audioEndMs() { return audioEndMs; },
    advance(nextAnchor?: PlaybackAnchor): SessionIdentity {
      identity = { ...identity, epoch: identity.epoch + 1 };
      anchor = nextAnchor && validAnchor(nextAnchor) ? { ...nextAnchor } : undefined;
      originMs = undefined;
      clockId = undefined;
      sequence = -1;
      playbackSequence = -1;
      audioEndMs = 0;
      return identity;
    },
    playback(event: PlaybackEvent): boolean {
      if (!sameIdentity(identity, event.identity) || !Number.isSafeInteger(event.sequence)
        || event.sequence <= playbackSequence || !validAnchor(event.anchor)) return false;
      playbackSequence = event.sequence;
      anchor = { ...event.anchor };
      return true;
    },
    audio(chunk: AudioChunk): "accepted" | "stale" | "invalid" | "gap" {
      if (!sameIdentity(identity, chunk.identity) || chunk.sequence <= sequence) return "stale";
      if (!validAudio(chunk)) return "invalid";
      const origin = chunk.capture.startMs - chunk.audioRange.startMs;
      if (chunk.sequence !== sequence + 1 || Math.abs(chunk.audioRange.startMs - audioEndMs) > 0.001
        || (clockId !== undefined && clockId !== chunk.capture.clockId)
        || (originMs !== undefined && Math.abs(origin - originMs) > 0.001)) return "gap";
      sequence = chunk.sequence;
      audioEndMs = chunk.audioRange.endMs;
      originMs = origin;
      clockId = chunk.capture.clockId;
      return "accepted";
    },
    map(range: AudioRange): AudioRange | undefined {
      if (!anchor || originMs === undefined || anchor.clockId !== clockId
        || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)
        || range.startMs < 0 || range.endMs < range.startMs || range.endMs > audioEndMs) return undefined;
      return {
        startMs: anchor.mediaTimeMs + (originMs + range.startMs - anchor.monotonicMs) * anchor.playbackRate,
        endMs: anchor.mediaTimeMs + (originMs + range.endMs - anchor.monotonicMs) * anchor.playbackRate,
      };
    },
  };
}
