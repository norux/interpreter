import type { AudioChunk, RuntimeLimits, SessionIdentity } from "../contracts";
import { sameIdentity } from "./identity";

export function validAudio(chunk: AudioChunk): boolean {
  const bytesPerSample = chunk.sampleFormat === "pcm-s16le" ? 2 : chunk.sampleFormat === "pcm-f32le" ? 4 : 0;
  const duration = chunk.audioRange.endMs - chunk.audioRange.startMs;
  return Number.isSafeInteger(chunk.sequence) && chunk.sequence >= 0
    && Number.isSafeInteger(chunk.sampleRate) && chunk.sampleRate > 0
    && Number.isSafeInteger(chunk.channels) && chunk.channels > 0
    && Number.isFinite(chunk.audioRange.startMs) && chunk.audioRange.startMs >= 0
    && Number.isFinite(duration) && duration > 0
    && Number.isFinite(chunk.capture.startMs) && Number.isFinite(chunk.capture.endMs)
    && chunk.capture.endMs > chunk.capture.startMs && chunk.capture.clockId.length > 0
    && Math.abs(chunk.capture.endMs - chunk.capture.startMs - duration) < 0.001
    && bytesPerSample > 0 && chunk.pcm.byteLength > 0
    && chunk.pcm.byteLength % (bytesPerSample * chunk.channels) === 0
    && Math.abs(chunk.pcm.byteLength / (bytesPerSample * chunk.channels * chunk.sampleRate) * 1000 - duration) < 0.001;
}

export function createAudioQueue(identity: SessionIdentity, limits: Pick<RuntimeLimits, "maxChunkBytes" | "maxAudioQueueMs">) {
  if (!Number.isSafeInteger(limits.maxChunkBytes) || limits.maxChunkBytes <= 0
    || !Number.isFinite(limits.maxAudioQueueMs) || limits.maxAudioQueueMs <= 0) {
    throw new Error("Audio queue limits must be positive and finite");
  }
  const chunks: AudioChunk[] = [];
  let pendingMs = 0;
  let closed = false;
  let waiting: ((value: IteratorResult<AudioChunk>) => void) | undefined;

  function clear(): number {
    const discardedMs = pendingMs;
    chunks.length = 0;
    pendingMs = 0;
    return discardedMs;
  }

  function close(): void {
    closed = true;
    clear();
    waiting?.({ done: true, value: undefined });
    waiting = undefined;
  }

  const stream: AsyncIterable<AudioChunk> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<AudioChunk>> {
          const chunk = chunks.shift();
          if (chunk) {
            pendingMs -= chunk.audioRange.endMs - chunk.audioRange.startMs;
            return Promise.resolve({ done: false, value: chunk });
          }
          if (closed) return Promise.resolve({ done: true, value: undefined });
          if (waiting) return Promise.reject(new Error("Audio queue has one consumer"));
          return new Promise((resolve) => { waiting = resolve; });
        },
        return(): Promise<IteratorResult<AudioChunk>> {
          close();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };

  return {
    stream,
    clear,
    close,
    get pendingMs() { return pendingMs; },
    push(chunk: AudioChunk): { state: "accepted" | "rejected" } | { state: "overflow"; droppedMs: number } {
      if (closed || !sameIdentity(identity, chunk.identity) || !validAudio(chunk)) return { state: "rejected" };
      const duration = chunk.audioRange.endMs - chunk.audioRange.startMs;
      if (chunk.pcm.byteLength > limits.maxChunkBytes || pendingMs + duration > limits.maxAudioQueueMs) {
        return { state: "overflow", droppedMs: clear() + duration };
      }
      if (waiting) {
        const receive = waiting;
        waiting = undefined;
        receive({ done: false, value: chunk });
      } else {
        chunks.push(chunk);
        pendingMs += duration;
      }
      return { state: "accepted" };
    },
  };
}
