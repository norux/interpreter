import type { AudioRange, SessionIdentity } from "../contracts";

// Bounded audio snapshots support both utterance and incremental decoding.
export interface AsrJob {
  readonly identity: SessionIdentity;
  readonly utteranceId: string;
  readonly audioRange: AudioRange;
  readonly language: "ja" | "en" | "ko" | "auto";
  readonly pcm: Float32Array;
  readonly timestamps?: true;
}

export interface AsrSegment {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function validAsrJob(value: unknown): value is AsrJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<AsrJob>;
  const identity = job.identity;
  const range = job.audioRange;
  if (!identity || typeof identity.sessionId !== "string" || !identity.sessionId.length || identity.sessionId.length > 256
    || typeof identity.targetId !== "string" || !identity.targetId.length || identity.targetId.length > 256
    || !Number.isSafeInteger(identity.epoch) || identity.epoch < 0
    || typeof job.utteranceId !== "string" || !job.utteranceId.length || job.utteranceId.length > 256
    || (job.timestamps !== undefined && job.timestamps !== true)
    || !["ja", "en", "ko", "auto"].includes(job.language ?? "") || !range
    || !Number.isFinite(range.startMs) || range.startMs < 0 || !Number.isFinite(range.endMs)
    || !(job.pcm instanceof Float32Array) || !(job.pcm.buffer instanceof ArrayBuffer)
    || job.pcm.byteOffset !== 0 || job.pcm.byteLength !== job.pcm.buffer.byteLength
    || job.pcm.length < 1600 || job.pcm.length > 16000 * 30
    || Math.abs(range.endMs - range.startMs - job.pcm.length / 16) > 1) return false;
  return job.pcm.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1);
}
