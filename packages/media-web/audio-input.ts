import type { AudioChunk, Capability, MediaTarget, RuntimeLimits, VideoInput } from "../contracts";
import type { createMediaCatalog } from "./catalog";

// The captured element stream leaves the site's playback path and source node alone.
export function createVideoInput(
  catalog: ReturnType<typeof createMediaCatalog>,
  workletUrl: string,
  limits: Pick<RuntimeLimits, "maxChunkBytes" | "maxAudioQueueMs">,
): VideoInput {
  if (!Number.isSafeInteger(limits.maxChunkBytes) || limits.maxChunkBytes < 8192
    || !Number.isFinite(limits.maxAudioQueueMs) || limits.maxAudioQueueMs <= 0) {
    throw new Error("Video input requires positive queue limits and at least 8192 chunk bytes");
  }
  let active = false;

  function route(target: MediaTarget): Capability {
    const video = catalog.resolve(target);
    if (!video) return { state: "unavailable", reason: "target-invalidated", message: "Choose the video again" };
    if (video.mediaKeys) return { state: "unavailable", reason: "protected-media", message: "Protected video is unsupported" };
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!capture || !video.ownerDocument.defaultView?.AudioContext) {
      return { state: "unavailable", reason: "execution-context-unavailable", message: "Selected-element Web Audio capture is unavailable" };
    }
    if (video.srcObject || !video.currentSrc || video.readyState < 2) {
      return { state: "unverified", reason: "media-route-unknown", message: "Load an ordinary same-origin video first" };
    }
    const url = new URL(video.currentSrc);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== video.ownerDocument.location.origin) {
      return { state: "unavailable", reason: "media-route-unknown", message: "Only ordinary same-origin media is verified by this adapter" };
    }
    return { state: "available" };
  }

  return {
    async probe(target) { return route(target); },
    async open(target, identity) {
      const capability = route(target);
      if (capability.state !== "available") throw new Error(`${capability.reason}: ${capability.message}`);
      if (identity.targetId !== target.id) throw new Error("Video input identity must match the selected target");
      if (active) throw new Error("Video input already has an active session");
      const video = catalog.resolve(target);
      const view = video?.ownerDocument.defaultView;
      if (!video || !view) throw new Error("target-invalidated");
      if (!view.navigator.userActivation.isActive) throw new Error("permission-required: Start requires user activation");
      if (video.paused || video.ended) throw new Error("suspended: Play the selected video before capture");
      const context = new view.AudioContext();
      active = true;
      const clockId = view.crypto.randomUUID();
      let stream: MediaStream | undefined;
      let source: MediaStreamAudioSourceNode | undefined;
      let audioTrack: MediaStreamTrack | undefined;
      let worklet: AudioWorkletNode | undefined;
      let closed = false;
      let failure: Error | undefined;
      let sequence = 0;
      let originFrame: number | undefined;
      let pendingMs = 0;
      const chunks: AudioChunk[] = [];
      let waiting: { resolve(value: IteratorResult<AudioChunk>): void; reject(error: Error): void } | undefined;
      let unsubscribe: (() => void) | undefined;
      const discontinuities = ["pause", "seeking", "ratechange", "ended", "emptied", "loadstart"];

      async function close() {
        if (closed) return;
        closed = true;
        active = false;
        chunks.length = 0;
        pendingMs = 0;
        unsubscribe?.();
        for (const event of discontinuities) video?.removeEventListener(event, invalidate);
        view?.removeEventListener("pagehide", invalidate);
        if (worklet) {
          worklet.port.onmessage = null;
          worklet.port.close();
          worklet.disconnect();
        }
        source?.disconnect();
        stream?.removeEventListener("addtrack", addedTrack);
        for (const track of stream?.getTracks() ?? []) { track.removeEventListener("ended", invalidate); track.stop(); }
        if (waiting) {
          if (failure) waiting.reject(failure);
          else waiting.resolve({ done: true, value: undefined });
          waiting = undefined;
        }
        if (context.state !== "closed") await context.close();
      }

      function addedTrack(event: MediaStreamTrackEvent) {
        // Initial capture track events may be queued before listeners are attached.
        if (event.track.kind === "video") { event.track.stop(); stream?.removeTrack(event.track); }
        else if (event.track !== audioTrack) invalidate();
      }

      function invalidate() {
        // V3 will introduce playback anchors/epochs; never join across a change now.
        failure = new Error("target-invalidated: Restart capture after a playback discontinuity");
        void close();
      }

      const events: AsyncIterable<AudioChunk> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              const chunk = chunks.shift();
              if (chunk) {
                pendingMs -= chunk.audioRange.endMs - chunk.audioRange.startMs;
                return Promise.resolve({ done: false as const, value: chunk });
              }
              if (failure) return Promise.reject(failure);
              if (closed) return Promise.resolve({ done: true as const, value: undefined });
              if (waiting) return Promise.reject(new Error("Video input has one consumer"));
              return new Promise<IteratorResult<AudioChunk>>((resolve, reject) => { waiting = { resolve, reject }; });
            },
            async return() { await close(); return { done: true, value: undefined }; },
          };
        },
      };

      for (const event of discontinuities) video.addEventListener(event, invalidate);
      view.addEventListener("pagehide", invalidate);
      unsubscribe = catalog.subscribe(() => { if (!catalog.resolve(target)) invalidate(); });

      try {
        // Resume during the user gesture, before awaiting worklet loading.
        await context.resume();
        if (context.state !== "running") throw new Error("suspended: Audio context did not start");
        await context.audioWorklet.addModule(workletUrl);
        if (closed || !catalog.resolve(target)) throw new Error("target-invalidated");
        const capture = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream;
        stream = capture.call(video);
        if (stream.getAudioTracks().length !== 1) throw new Error("media-route-unknown: Expected one captured audio track");
        audioTrack = stream.getAudioTracks()[0];
        for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track); }
        source = context.createMediaStreamSource(stream);
        worklet = new view.AudioWorkletNode(context, "selected-video-pcm");
        worklet.port.onmessage = ({ data }: MessageEvent<{ frame: number; pcm: ArrayBuffer }>) => {
          if (closed) return;
          if (!catalog.resolve(target)) { invalidate(); return; }
          originFrame ??= data.frame;
          const duration = data.pcm.byteLength / 4 / context.sampleRate * 1000;
          const startMs = (data.frame - originFrame) / context.sampleRate * 1000;
          const chunk: AudioChunk = {
            identity: { ...identity }, scope: "selected-video", sequence: sequence++,
            audioRange: { startMs, endMs: startMs + duration },
            capture: { clockId, startMs: data.frame / context.sampleRate * 1000, endMs: data.frame / context.sampleRate * 1000 + duration },
            sampleRate: context.sampleRate, channels: 1, sampleFormat: "pcm-f32le", pcm: data.pcm,
          };
          if (data.pcm.byteLength > limits.maxChunkBytes || pendingMs + duration > limits.maxAudioQueueMs) {
            failure = new Error(`audio-gap: Video input queue overflow (${pendingMs + duration} ms discarded)`);
            void close();
          } else if (waiting) {
            waiting.resolve({ done: false, value: chunk });
            waiting = undefined;
          } else { chunks.push(chunk); pendingMs += duration; }
        };
        worklet.onprocessorerror = () => { failure = new Error("audio-gap: PCM processor failed"); void close(); };
        source.connect(worklet);
        // Only the worklet's silent output reaches this context's destination.
        worklet.connect(context.destination);
        stream.addEventListener("addtrack", addedTrack);
        for (const track of stream.getAudioTracks()) track.addEventListener("ended", invalidate);
        return { events, close };
      } catch (error) {
        await close();
        throw error;
      }
    },
  };
}
