import type { AudioChunk, Capability, MediaCandidate, MediaTarget, PlaybackEvent, SessionIdentity, VideoInput } from "../../packages/contracts";
import { validAudio } from "../../packages/core/audio-queue";
import { sameIdentity } from "../../packages/core/identity";
import { createTimeline } from "../../packages/core/timeline";

export const channelName = "interpreter-selected-video-v1";
const channelWindow = 4;
const maxBytes = 8192;
const maxWireChars = 14000;
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max = 256): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function validTarget(value: unknown): value is MediaTarget {
  return record(value) && text(value.id) && text(value.documentId) && value.frameId === "0";
}
function validIdentity(value: unknown): value is SessionIdentity {
  return record(value) && text(value.sessionId) && text(value.targetId) && integer(value.epoch);
}
function envelope(value: unknown): value is RecordValue {
  return record(value) && value.version === 1 && text(value.type, 32)
    && JSON.stringify(value).length <= maxWireChars;
}
function encodeEvent(event: AudioChunk | PlaybackEvent) {
  if ("type" in event) return event;
  if (event.pcm.byteLength > maxBytes || !validAudio(event)) throw new Error("audio-gap: Invalid page PCM");
  let bytes = "";
  for (const byte of new Uint8Array(event.pcm)) bytes += String.fromCharCode(byte);
  return { ...event, pcm: btoa(bytes) };
}
function decodeEvent(value: unknown, identity: SessionIdentity): AudioChunk | PlaybackEvent {
  if (!record(value) || !validIdentity(value.identity) || !sameIdentity(value.identity, identity) || !integer(value.sequence)) {
    throw new Error("audio-gap: Invalid channel identity or sequence");
  }
  if ("type" in value) {
    const anchor = value.anchor;
    if (!["play", "pause", "seek", "rate", "source", "end"].includes(String(value.type)) || !record(anchor)
      || !text(anchor.clockId) || !finite(anchor.monotonicMs) || !finite(anchor.mediaTimeMs) || anchor.mediaTimeMs < 0
      || !finite(anchor.playbackRate) || anchor.playbackRate <= 0) throw new Error("audio-gap: Invalid playback anchor");
    return value as unknown as PlaybackEvent;
  }
  if (value.scope !== "selected-video" || value.channels !== 1 || value.sampleFormat !== "pcm-f32le"
    || !integer(value.sampleRate) || value.sampleRate < 8000 || value.sampleRate > 192000
    || !record(value.audioRange) || !record(value.capture) || !text(value.capture.clockId)
    || typeof value.pcm !== "string" || value.pcm.length > 10924 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.pcm)) {
    throw new Error("audio-gap: Invalid channel PCM");
  }
  const decoded = atob(value.pcm);
  if (!decoded.length || decoded.length > maxBytes) throw new Error("audio-gap: Invalid PCM size");
  const pcm = Uint8Array.from(decoded, char => char.charCodeAt(0)).buffer;
  const chunk = { ...value, pcm } as unknown as AudioChunk;
  if (!validAudio(chunk) || new Float32Array(pcm).some(sample => !Number.isFinite(sample))) throw new Error("audio-gap: Invalid PCM samples or timing");
  return chunk;
}
function capability(value: unknown): value is Capability {
  return record(value) && (value.state === "available" || (["download-required", "permission-required", "unavailable", "unverified"].includes(String(value.state))
    && ["media-access-denied", "protected-media", "frame-permission-required", "media-route-unknown", "target-invalidated", "execution-context-unavailable"].includes(String(value.reason)) && text(value.message, 1024)));
}
function candidates(value: unknown): value is MediaCandidate[] {
  return Array.isArray(value) && value.length <= 32 && value.every(item => record(item) && validTarget(item.target)
    && text(item.label, 128) && typeof item.visible === "boolean" && typeof item.playing === "boolean"
    && finite(item.width) && item.width >= 0 && finite(item.height) && item.height >= 0);
}

// tabs.connect is a direct document/content data channel. The service worker
// neither receives samples nor owns inference. Chrome serializes messages as JSON.
export function createRemoteVideoInput(port: chrome.runtime.Port) {
  let requestSequence = 0;
  let disposed = false;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let active: { id: string; identity: SessionIdentity; timeline: ReturnType<typeof createTimeline>;
    queue: { number: number; event: AudioChunk | PlaybackEvent }[]; next: number; ended: boolean; failure?: Error;
    waiting?: { resolve(value: IteratorResult<AudioChunk | PlaybackEvent>): void; reject(error: Error): void } } | undefined;
  const listeners = new Set<() => void>();
  function send(message: RecordValue) { port.postMessage({ version: 1, ...message }); }
  function finish(error?: Error) {
    if (!active || (active.ended && active.failure)) return;
    active.ended = true; active.failure = error; active.queue.length = 0;
    if (error) active.waiting?.reject(error); else active.waiting?.resolve({ done: true, value: undefined });
    active.waiting = undefined;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; finish(new Error("context-destroyed: Selected page channel closed"));
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("context-destroyed: Selected page channel closed")); }
    pending.clear();
    for (const listener of listeners) listener();
    listeners.clear();
    port.onMessage.removeListener(receive); port.onDisconnect.removeListener(dispose); port.disconnect();
  }
  function request(type: string, fields: RecordValue = {}): Promise<unknown> {
    if (disposed) return Promise.reject(new Error("context-destroyed: Selected page channel closed"));
    if (pending.size >= 4) return Promise.reject(new Error("overloaded: Too many page commands"));
    const requestId = String(++requestSequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("permission-required: Page command timed out; Stop before retrying"));
        if (type === "open") { finish(new Error("permission-required: Page Start timed out")); send({ type: "close", streamId: requestId }); }
      }, type === "open" ? 60000 : 10000);
      pending.set(requestId, { resolve, reject, timer });
      if (type === "open") active = { id: requestId, identity: fields.identity as SessionIdentity,
        timeline: createTimeline(fields.identity as SessionIdentity), queue: [], next: 0, ended: false };
      try { send({ type, requestId, ...fields }); } catch { dispose(); }
    });
  }
  function receive(value: unknown) {
    try {
      if (!envelope(value)) throw new Error("audio-gap: Invalid page envelope");
      if (value.type === "changed") { for (const listener of listeners) listener(); return; }
      if (value.type === "reply") {
        if (!text(value.requestId)) throw new Error("audio-gap: Invalid reply identity");
        const task = pending.get(value.requestId);
        if (!task) return;
        if (value.error !== undefined && !text(value.error, 1024)) throw new Error("audio-gap: Invalid page error");
        pending.delete(value.requestId); clearTimeout(task.timer);
        if (value.error) task.reject(new Error(String(value.error))); else task.resolve(value.result);
        return;
      }
      if (!active || value.streamId !== active.id || active.ended) return;
      if (value.type === "end") {
        if (value.error !== undefined && !text(value.error, 1024)) throw new Error("audio-gap: Invalid stream error");
        // Normal EOF preserves already accepted events; an error discards them.
        if (value.error) finish(new Error(String(value.error)));
        else { active.ended = true; if (!active.queue.length) active.waiting?.resolve({ done: true, value: undefined }); active.waiting = undefined; }
        return;
      }
      if (value.type !== "event" || value.number !== active.next++) throw new Error("audio-gap: Page channel sequence gap");
      const event = decodeEvent(value.event, active.identity);
      if ("type" in event ? !active.timeline.playback(event)
        : active.timeline.audio(event) !== "accepted" || !active.timeline.map(event.audioRange)) throw new Error("audio-gap: Page media timeline gap");
      if (active.queue.length >= channelWindow) throw new Error("audio-gap: Page acknowledgement window overflow");
      if (active.waiting) {
        const waiting = active.waiting; active.waiting = undefined;
        send({ type: "ack", streamId: active.id, number: value.number }); waiting.resolve({ done: false, value: event });
      } else active.queue.push({ number: Number(value.number), event });
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); dispose(); }
  }
  port.onMessage.addListener(receive); port.onDisconnect.addListener(dispose);
  const input: VideoInput = {
    async probe(target) { if (!validTarget(target)) throw new Error("target-invalidated");
      const result = await request("probe", { target }); if (!capability(result)) { dispose(); throw new Error("Invalid page capability"); } return result; },
    async open(target, identity) {
      if (!validTarget(target) || !validIdentity(identity) || identity.targetId !== target.id) throw new Error("target-invalidated");
      if (active && !active.ended) throw new Error("Selected page already has a session");
      try { const result = await request("open", { target, identity }); if (result !== "opened") throw new Error("Invalid page open reply"); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); throw error; }
      const owned = active;
      if (!owned || owned.ended) throw new Error("cancelled: Page Start stopped");
      const streamId = owned.id;
      async function close() {
        if (active !== owned) return;
        finish(); active = undefined;
        // Fire-and-forget close invalidates the page synchronously on receipt.
        if (!disposed) send({ type: "close", streamId });
      }
      return { close, events: { [Symbol.asyncIterator]() { return {
        next(): Promise<IteratorResult<AudioChunk | PlaybackEvent>> {
          if (owned.failure) return Promise.reject(owned.failure);
          const item = owned.queue.shift();
          if (item) { send({ type: "ack", streamId: owned.id, number: item.number }); return Promise.resolve({ done: false, value: item.event }); }
          if (owned.ended) return Promise.resolve({ done: true, value: undefined });
          if (owned.waiting) return Promise.reject(new Error("Selected page has one consumer"));
          return new Promise((resolve, reject) => { owned.waiting = { resolve, reject }; });
        }, async return() { await close(); return { done: true, value: undefined }; },
      }; } } };
    },
  };
  function stop() {
    if (!active) return;
    const id = active.id;
    finish(); active = undefined;
    const task = pending.get(id);
    if (task) { clearTimeout(task.timer); pending.delete(id); task.reject(new Error("cancelled: Page Start stopped")); }
    if (!disposed) send({ type: "close", streamId: id });
  }
  return { input, stop, async discover() { const result = await request("discover"); if (!candidates(result)) { dispose(); throw new Error("Invalid page catalog"); } return result; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, dispose };
}

export function serveVideoInput(port: chrome.runtime.Port, input: VideoInput,
  catalog: { discover(): Promise<readonly MediaCandidate[]>; subscribe(listener: () => void): () => void },
  startFromGesture: (start: () => void, cancel: () => void) => () => void) {
  let disposed = false;
  type PageSession = { id: string; handle?: Awaited<ReturnType<VideoInput["open"]>>; cancelled: boolean;
    sent: number; acknowledged: number; wake?: () => void; cancelGesture?: () => void };
  let active: PageSession | undefined;
  function send(message: RecordValue) { if (!disposed) port.postMessage({ version: 1, ...message }); }
  function stop() {
    const owned = active; active = undefined;
    if (!owned) return;
    owned.cancelled = true; owned.cancelGesture?.(); owned.wake?.(); void owned.handle?.close();
    send({ type: "reply", requestId: owned.id, error: "cancelled: Selected video Start stopped" });
  }
  const unsubscribe = catalog.subscribe(() => send({ type: "changed" }));
  function dispose() { if (disposed) return; stop(); disposed = true; unsubscribe();
    port.onMessage.removeListener(receive); port.onDisconnect.removeListener(dispose); port.disconnect(); }
  async function pump(owned: PageSession) {
    try {
      if (!owned.handle) throw new Error("Page capture is not open");
      for await (const event of owned.handle.events) {
        if (owned.cancelled) break;
        if (owned.sent - owned.acknowledged >= channelWindow) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { owned.wake = undefined; reject(new Error("audio-gap: Page acknowledgements stalled for 1000 ms")); }, 1000);
            owned.wake = () => { clearTimeout(timer); owned.wake = undefined; resolve(); };
          });
        }
        if (owned.cancelled) break;
        send({ type: "event", streamId: owned.id, number: owned.sent++, event: encodeEvent(event) });
      }
      if (!owned.cancelled) send({ type: "end", streamId: owned.id });
    } catch (error) { if (!owned.cancelled) send({ type: "end", streamId: owned.id, error: String(error instanceof Error ? error.message : error).slice(0, 1024) }); }
    finally { await owned.handle?.close(); if (active === owned) active = undefined; }
  }
  function receive(value: unknown) {
    if (!envelope(value)) { dispose(); return; }
    if (value.type === "ack") {
      if (!active || value.streamId !== active.id) return;
      if (value.number !== active.acknowledged || active.acknowledged >= active.sent) { dispose(); return; }
      active.acknowledged++; active.wake?.(); return;
    }
    if (value.type === "close") { if (value.streamId === active?.id) stop(); return; }
    if (!text(value.requestId) || !["discover", "probe", "open"].includes(String(value.type))) { dispose(); return; }
    const requestId = value.requestId;
    if (value.type === "discover") {
      void catalog.discover().then(result => send({ type: "reply", requestId, result: result.slice(0, 16).map(item => ({ ...item, label: item.label.slice(0, 128) || "Video" })) }))
        .catch(() => send({ type: "reply", requestId, error: "target-invalidated: Cannot discover this document" })); return;
    }
    if (!validTarget(value.target)) { dispose(); return; }
    const target = value.target;
    if (value.type === "probe") { void input.probe(target).then(result => send({ type: "reply", requestId, result }))
      .catch(() => send({ type: "reply", requestId, error: "target-invalidated: Cannot probe this video" })); return; }
    if (!validIdentity(value.identity) || value.identity.targetId !== target.id) { dispose(); return; }
    if (active) { send({ type: "reply", requestId, error: "overloaded: Page already has a session" }); return; }
    const identity = value.identity;
    const owned: PageSession = { id: requestId, cancelled: false, sent: 0, acknowledged: 0 };
    active = owned;
    owned.cancelGesture = startFromGesture(() => {
      if (owned.cancelled || owned.handle) return;
      // input.open is invoked directly inside the PAGE click, before any await.
      void input.open(target, identity).then(handle => {
        if (owned.cancelled) { void handle.close(); return; }
        owned.handle = handle; owned.cancelGesture?.(); send({ type: "reply", requestId, result: "opened" }); void pump(owned);
      }).catch(error => { if (!owned.cancelled) { send({ type: "reply", requestId, error: String(error.message).slice(0, 1024) }); stop(); } });
    }, stop);
  }
  port.onMessage.addListener(receive); port.onDisconnect.addListener(dispose);
  return { dispose };
}
