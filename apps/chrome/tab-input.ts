import type { AudioChunk, MediaTarget, MediaTargetId, RuntimeLimits, SessionIdentity, VideoInput } from "../../packages/contracts";

// The persistent extension document owns both playback and PCM. It must capture
// immediately after the action, before waiting for model/translator preparation.
export function createChromeTabInput(tabId: number, workletUrl: string,
  limits: Pick<RuntimeLimits, "maxChunkBytes" | "maxAudioQueueMs">, onInterrupted: (reason: string) => void) {
  if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new Error("Invalid capture tab");
  if (!Number.isSafeInteger(limits.maxChunkBytes) || limits.maxChunkBytes < 8192
    || !Number.isFinite(limits.maxAudioQueueMs) || limits.maxAudioQueueMs <= 0) throw new Error("Invalid tab PCM limits");
  const target: MediaTarget & { readonly scope: "tab-mix"; readonly tabId: number } = {
    id: `tab-${tabId}-${crypto.randomUUID()}` as MediaTargetId, documentId: crypto.randomUUID(), frameId: "tab", scope: "tab-mix", tabId,
  };
  type Capture = { stream?: MediaStream; context?: AudioContext; source?: MediaStreamAudioSourceNode;
    worklet?: AudioWorkletNode; retired: boolean; closeInput?: () => void; cleanup?: Promise<void> };
  let current: Capture | undefined;
  let disposed = false;
  function matches(selected: MediaTarget) {
    return selected.id === target.id && selected.documentId === target.documentId && selected.frameId === target.frameId;
  }
  function release(owned: Capture): Promise<void> {
    owned.retired = true;
    if (current === owned) current = undefined;
    owned.closeInput?.();
    if (owned.cleanup) return owned.cleanup;
    if (owned.worklet) { owned.worklet.port.onmessage = null; owned.worklet.port.close(); owned.worklet.disconnect(); }
    owned.source?.disconnect();
    for (const track of owned.stream?.getTracks() ?? []) track.stop();
    owned.cleanup = owned.context && owned.context.state !== "closed" ? owned.context.close() : Promise.resolve();
    return owned.cleanup;
  }
  function stop(): Promise<void> { return current ? release(current) : Promise.resolve(); }
  function interrupted(reason: string) {
    if (!current) return;
    void stop(); onInterrupted(reason);
  }
  function updated(id: number, info: chrome.tabs.OnUpdatedInfo) {
    if (id === tabId && info.status === "loading") interrupted("target-invalidated: Captured tab navigated; start again from its extension action");
  }
  function removed(id: number) { if (id === tabId) interrupted("target-invalidated: Captured tab closed"); }
  function pagehide() { void stop(); }
  chrome.tabs?.onUpdated.addListener(updated); chrome.tabs?.onRemoved.addListener(removed);
  window.addEventListener("pagehide", pagehide);
  const input: VideoInput = {
    async probe(selected) {
      return matches(selected) && current?.stream?.active && !current.retired
        ? { state: "available" }
        : { state: "unavailable", reason: "permission-required", message: "Start capture using the extension action on the original tab" };
    },
    async open(selected, identity: SessionIdentity) {
      const owned = current;
      if (!matches(selected) || identity.targetId !== target.id || !owned?.context || !owned.stream?.active || owned.retired) throw new Error("permission-required: No authorized tab capture");
      if (owned.closeInput) throw new Error("Tab input already has an active session");
      const context = owned.context;
      const clockId = crypto.randomUUID();
      let ended = false;
      let failure: Error | undefined;
      let sequence = 0;
      let originFrame: number | undefined;
      let pendingMs = 0;
      const chunks: AudioChunk[] = [];
      let waiting: { resolve(value: IteratorResult<AudioChunk>): void; reject(error: Error): void } | undefined;
      owned.closeInput = () => {
        ended = true; chunks.length = 0; pendingMs = 0;
        if (waiting) { if (failure) waiting.reject(failure); else waiting.resolve({ done: true, value: undefined }); waiting = undefined; }
      };
      const fail = (message: string) => { failure = new Error(message); void release(owned); onInterrupted(message); };
      try {
        await context.audioWorklet.addModule(workletUrl);
        if (owned.retired) throw new Error("cancelled: Capture stopped during PCM startup");
        owned.worklet = new AudioWorkletNode(context, "selected-video-pcm");
        owned.worklet.port.onmessage = ({ data }: MessageEvent<{ frame: number; pcm: ArrayBuffer }>) => {
          if (owned.retired || ended) return;
          originFrame ??= data.frame;
          const duration = data.pcm.byteLength / 4 / context.sampleRate * 1000;
          if (data.pcm.byteLength > limits.maxChunkBytes || pendingMs + duration > limits.maxAudioQueueMs) {
            fail(`audio-gap: Tab input queue overflow (${pendingMs + duration} ms discarded)`); return;
          }
          const startMs = (data.frame - originFrame) / context.sampleRate * 1000;
          const chunk: AudioChunk = { identity: { ...identity }, scope: "tab-mix", sequence: sequence++,
            audioRange: { startMs, endMs: startMs + duration },
            capture: { clockId, startMs: data.frame / context.sampleRate * 1000, endMs: data.frame / context.sampleRate * 1000 + duration },
            sampleRate: context.sampleRate, channels: 1, sampleFormat: "pcm-f32le", pcm: data.pcm };
          if (waiting) { waiting.resolve({ done: false, value: chunk }); waiting = undefined; }
          else { pendingMs += duration; chunks.push(chunk); }
        };
        owned.worklet.onprocessorerror = () => fail("audio-gap: Tab PCM processor failed");
        owned.source?.connect(owned.worklet);
        // A second silent branch keeps PCM processing alive without doubling output.
        owned.worklet.connect(context.destination);
        return { events: { [Symbol.asyncIterator]() { return {
          next() {
            const chunk = chunks.shift();
            if (chunk) { pendingMs -= chunk.audioRange.endMs - chunk.audioRange.startMs; return Promise.resolve({ done: false as const, value: chunk }); }
            if (failure) return Promise.reject(failure);
            if (ended) return Promise.resolve({ done: true as const, value: undefined });
            if (waiting) return Promise.reject(new Error("Tab input has one consumer"));
            return new Promise<IteratorResult<AudioChunk>>((resolve, reject) => { waiting = { resolve, reject }; });
          },
          async return() { await release(owned); return { done: true, value: undefined }; },
        }; } }, close: () => release(owned) };
      } catch (error) { await release(owned); throw error; }
    },
  };
  return { target, input, stop,
    get audioTrack() { return current?.stream?.getAudioTracks()[0]; },
    async capture(streamId?: string) {
      if (disposed) throw new Error("context-destroyed: Tab input disposed");
      if (current) throw new Error("Tab capture already active or starting");
      const owned: Capture = { retired: false }; current = owned;
      try {
        // Obtain and consume in this document; stream IDs are single-use and expire.
        const id = streamId ?? await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        if (owned.retired) throw new Error("cancelled: Capture stopped during authorization");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: id },
        } as MediaTrackConstraints, video: false });
        owned.stream = stream;
        if (owned.retired) { for (const track of stream.getTracks()) track.stop(); throw new Error("cancelled: Capture stopped during acquisition"); }
        owned.context = new AudioContext({ latencyHint: "playback" });
        owned.source = owned.context.createMediaStreamSource(stream);
        owned.source.connect(owned.context.destination);
        for (const track of stream.getTracks()) track.addEventListener("ended", () => {
          if (!owned.retired) interrupted("target-invalidated: Tab capture ended");
        });
        await owned.context.resume();
        if (owned.retired || owned.context.state !== "running") throw new Error("suspended: Tab playback context did not start");
      } catch (error) { await release(owned); throw error; }
    },
    async dispose() {
      disposed = true; chrome.tabs?.onUpdated.removeListener(updated); chrome.tabs?.onRemoved.removeListener(removed);
      window.removeEventListener("pagehide", pagehide); await stop();
    },
  };
}
