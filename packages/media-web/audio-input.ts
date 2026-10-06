import type { AudioChunk, Capability, MediaTarget, PlaybackEvent, RuntimeLimits, SessionIdentity, VideoInput } from "../contracts";
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
  let authorized: SessionIdentity | undefined;

  function route(target: MediaTarget): Capability {
    if (target.frameId !== catalog.frameId) {
      return { state: "permission-required", reason: "frame-permission-required", message: "Select this video through its own permitted frame adapter" };
    }
    const video = catalog.resolve(target);
    if (!video) return { state: "unavailable", reason: "target-invalidated", message: "Choose the video again" };
    if (video.mediaKeys) return { state: "unavailable", reason: "protected-media", message: "Protected video is unsupported" };
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!capture || !video.ownerDocument.defaultView?.AudioContext) {
      return { state: "unavailable", reason: "execution-context-unavailable", message: "Selected-element Web Audio capture is unavailable" };
    }
    if (video.srcObject || !video.currentSrc || (video.readyState < 2 && !(video.seeking && video.readyState >= 1))) {
      return { state: "unverified", reason: "media-route-unknown", message: "Load an ordinary HTTP video first; stream routes are unverified" };
    }
    const url = new URL(video.currentSrc);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { state: "unavailable", reason: "media-route-unknown", message: "Blob/MSE and non-HTTP media require a verified site adapter" };
    }
    if (url.origin !== video.ownerDocument.location.origin && video.crossOrigin === null) {
      return { state: "unavailable", reason: "media-access-denied", message: "Cross-origin playback without CORS mode cannot be captured; playback is unchanged" };
    }
    // This is route eligibility, not access proof. captureStream enforces the loaded
    // resource's origin cleanliness, including redirects and late attribute changes.
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
      if (!view.navigator.userActivation.isActive
        && !(authorized?.sessionId === identity.sessionId && authorized.targetId === identity.targetId)) {
        throw new Error("permission-required: Start requires user activation");
      }
      if (video.paused || video.ended) throw new Error("suspended: Play the selected video before capture");
      const context = new view.AudioContext();
      active = true;
      const clockId = view.crypto.randomUUID();
      let stream: MediaStream | undefined;
      let source: MediaStreamAudioSourceNode | undefined;
      let audioTrack: MediaStreamTrack | undefined;
      let worklet: AudioWorkletNode | undefined;
      let closed = false;
      let ended = false;
      let cleanup: Promise<void> | undefined;
      let failure: Error | undefined;
      let sequence = 0;
      let playbackSequence = 0;
      let originFrame: number | undefined;
      let pendingMs = 0;
      const chunks: (AudioChunk | PlaybackEvent)[] = [];
      let waiting: { resolve(value: IteratorResult<AudioChunk | PlaybackEvent>): void; reject(error: Error): void } | undefined;
      let unsubscribe: (() => void) | undefined;
      let cancelSeek: (() => void) | undefined;
      const discontinuities = ["pause", "seeking", "ratechange", "ended", "emptied", "loadstart"];

      function release(): Promise<void> {
        if (cleanup) return cleanup;
        active = false;
        unsubscribe?.();
        cancelSeek?.();
        for (const event of discontinuities) video?.removeEventListener(event, playback);
        view?.removeEventListener("pagehide", invalidate);
        if (worklet) {
          worklet.port.onmessage = null;
          worklet.port.close();
          worklet.disconnect();
        }
        source?.disconnect();
        stream?.removeEventListener("addtrack", addedTrack);
        for (const track of stream?.getTracks() ?? []) { track.removeEventListener("ended", invalidate); track.stop(); }
        cleanup = context.state === "closed" ? Promise.resolve() : context.close();
        return cleanup;
      }

      async function close() {
        closed = true;
        chunks.length = 0;
        pendingMs = 0;
        if (waiting) {
          if (failure) waiting.reject(failure);
          else waiting.resolve({ done: true, value: undefined });
          waiting = undefined;
        }
        await release();
      }

      function emit(event: AudioChunk | PlaybackEvent) {
        if (waiting) { waiting.resolve({ done: false, value: event }); waiting = undefined; }
        else chunks.push(event);
      }

      function anchor(type: PlaybackEvent["type"]): PlaybackEvent {
        // currentTime and worklet currentFrame share the AudioContext's time origin.
        return { identity: { ...identity }, sequence: playbackSequence++, type,
          anchor: { clockId, monotonicMs: context.currentTime * 1000,
            mediaTimeMs: video?.currentTime ? video.currentTime * 1000 : 0, playbackRate: video?.playbackRate ?? 1 } };
      }

      function discontinuity(type: PlaybackEvent["type"]) {
        if (closed || ended) return;
        ended = true;
        chunks.length = 0;
        pendingMs = 0;
        // The core receives the old identity and advances its epoch before cancel.
        emit(anchor(type));
        void release();
      }

      function playback(event: Event) {
        const type = event.type === "seeking" ? "seek" : event.type === "ratechange" ? "rate"
          : event.type === "ended" ? "end" : event.type === "pause" ? "pause" : "source";
        discontinuity(type);
      }

      function addedTrack(event: MediaStreamTrackEvent) {
        // Initial capture track events may be queued before listeners are attached.
        if (event.track.kind === "video") { event.track.stop(); stream?.removeTrack(event.track); }
        else if (event.track !== audioTrack) invalidate();
      }

      function invalidate() {
        if (closed || ended) return;
        failure = new Error("target-invalidated: Selected capture was lost");
        void close();
      }

      const events: AsyncIterable<AudioChunk | PlaybackEvent> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              const chunk = chunks.shift();
              if (chunk) {
                if (!("type" in chunk)) pendingMs -= chunk.audioRange.endMs - chunk.audioRange.startMs;
                return Promise.resolve({ done: false as const, value: chunk });
              }
              if (failure) return Promise.reject(failure);
              if (closed || ended) return Promise.resolve({ done: true as const, value: undefined });
              if (waiting) return Promise.reject(new Error("Video input has one consumer"));
              return new Promise<IteratorResult<AudioChunk | PlaybackEvent>>((resolve, reject) => { waiting = { resolve, reject }; });
            },
            async return() { await close(); return { done: true, value: undefined }; },
          };
        },
      };

      for (const event of discontinuities) video.addEventListener(event, playback);
      view.addEventListener("pagehide", invalidate);
      unsubscribe = catalog.subscribe(() => { if (!catalog.resolve(target)) discontinuity("source"); });

      try {
        // Resume during the user gesture, before awaiting worklet loading.
        await context.resume();
        if (context.state !== "running") throw new Error("suspended: Audio context did not start");
        await context.audioWorklet.addModule(workletUrl);
        if (video.seeking && !closed && !ended) {
          await new Promise<void>((resolve) => {
            const done = () => { video.removeEventListener("seeked", done); cancelSeek = undefined; resolve(); };
            cancelSeek = done;
            video.addEventListener("seeked", done, { once: true });
          });
        }
        if (closed || ended || !catalog.resolve(target)) throw new Error("target-invalidated");
        const capture = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream;
        try { stream = capture.call(video); }
        catch (error) {
          if (error instanceof view.DOMException && error.name === "SecurityError") {
            throw new Error("media-access-denied: The loaded video resource does not permit sample access; playback is unchanged");
          }
          throw error;
        }
        if (stream.getAudioTracks().length !== 1) throw new Error("media-route-unknown: Expected one captured audio track");
        audioTrack = stream.getAudioTracks()[0];
        for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track); }
        source = context.createMediaStreamSource(stream);
        worklet = new view.AudioWorkletNode(context, "selected-video-pcm");
        worklet.port.onmessage = ({ data }: MessageEvent<{ frame: number; pcm: ArrayBuffer }>) => {
          if (closed || ended) return;
          if (!catalog.resolve(target)) { discontinuity("source"); return; }
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
          } else {
            if (!waiting) pendingMs += duration;
            emit(chunk);
          }
        };
        worklet.onprocessorerror = () => { failure = new Error("audio-gap: PCM processor failed"); void close(); };
        source.connect(worklet);
        // Only the worklet's silent output reaches this context's destination.
        worklet.connect(context.destination);
        emit(anchor("play"));
        authorized = { ...identity };
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
