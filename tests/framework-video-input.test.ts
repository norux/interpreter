import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioChunk, MediaTarget, MediaTargetId, PlaybackEvent } from "../packages/contracts";
import { createTimeline } from "../packages/core/timeline";
import { createVideoInput } from "../packages/media-web/audio-input";
import type { createMediaCatalog } from "../packages/media-web/catalog";

// Port/lifecycle mocks only. Real decoded audio acceptance lives in framework-video-audio.mjs.
function fixture() {
  const target: MediaTarget = { id: "selected" as MediaTargetId, documentId: "doc", frameId: "frame" };
  const identity = { sessionId: "session", targetId: target.id, epoch: 0 };
  const contexts: { currentTime: number; state: string; closes: number }[] = [];
  const processors: { port: { onmessage: ((event: { data: { frame: number; pcm: ArrayBuffer } }) => void) | null } }[] = [];
  let current = true;
  let subscriber: (() => void) | undefined;
  let captureCount = 0;
  let stops = 0;
  const activation = { isActive: true };
  const view = Object.assign(new EventTarget(), {
    DOMException,
    crypto: { randomUUID: () => `clock-${contexts.length}` }, navigator: { userActivation: activation },
    AudioContext: class {
      currentTime = 2;
      sampleRate = 48000;
      state = "suspended";
      closes = 0;
      destination = {};
      audioWorklet = { async addModule() {} };
      constructor() { contexts.push(this); }
      async resume() { this.state = "running"; }
      async close() { this.state = "closed"; this.closes++; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    },
    AudioWorkletNode: class {
      port = { onmessage: null as ((event: { data: { frame: number; pcm: ArrayBuffer } }) => void) | null, close() {} };
      constructor() { processors.push(this); }
      connect() {}
      disconnect() {}
    },
  });
  const video = Object.assign(new EventTarget(), {
    mediaKeys: null, srcObject: null, currentSrc: "http://fixture.test/tone.webm", readyState: 4,
    paused: false, ended: false, seeking: false, currentTime: 10, playbackRate: 1,
    ownerDocument: { defaultView: view, location: { origin: "http://fixture.test" } },
    captureStream() {
      captureCount++;
      const track = Object.assign(new EventTarget(), { kind: "audio", stop() { stops++; } });
      return Object.assign(new EventTarget(), { getAudioTracks: () => [track], getVideoTracks: () => [],
        getTracks: () => [track], removeTrack() {} });
    },
  });
  const catalog = {
    frameId: "frame",
    resolve() { return current ? video as unknown as HTMLVideoElement : undefined; },
    subscribe(listener: () => void) { subscriber = listener; return () => { subscriber = undefined; }; },
  } as unknown as ReturnType<typeof createMediaCatalog>;
  const input = createVideoInput(catalog, "/pcm-worklet.js", { maxChunkBytes: 8192, maxAudioQueueMs: 500 });
  return { input, video, view, activation, target, identity, contexts, processors,
    replace() { current = false; subscriber?.(); },
    get captures() { return captureCount; }, get stops() { return stops; },
    pcm(frame = 96000) { processors.at(-1)?.port.onmessage?.({ data: { frame, pcm: new ArrayBuffer(8192) } }); },
  };
}

function playback(value: AudioChunk | PlaybackEvent): PlaybackEvent {
  assert.ok("type" in value);
  return value;
}

function audio(value: AudioChunk | PlaybackEvent): AudioChunk {
  assert.ok(!("type" in value));
  return value;
}

test("input emits an AudioContext anchor before PCM, maps capture ranges at the observed video rate", async () => {
  const f = fixture();
  f.video.playbackRate = 2;
  const handle = await f.input.open(f.target, f.identity);
  const events = handle.events[Symbol.asyncIterator]();
  f.pcm();
  const start = playback((await events.next()).value);
  assert.deepEqual(start, { identity: f.identity, sequence: 0, type: "play",
    anchor: { clockId: "clock-1", monotonicMs: 2000, mediaTimeMs: 10000, playbackRate: 2 } });
  const chunk = audio((await events.next()).value);
  assert.equal(chunk.capture.clockId, start.anchor.clockId);
  assert.equal(chunk.sequence, 0);
  const timeline = createTimeline(f.identity);
  assert.equal(timeline.playback(start), true);
  assert.equal(timeline.audio(chunk), "accepted");
  const mapped = timeline.map(chunk.audioRange);
  assert.equal(mapped?.startMs, 10000);
  assert.ok(Math.abs((mapped?.endMs ?? 0) - 10085.333333333334) < 0.001);
  const pending = events.next();
  await handle.close(); await handle.close();
  assert.equal((await pending).done, true);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.stops, 1);
});

for (const [event, type] of [["seeking", "seek"], ["pause", "pause"], ["ratechange", "rate"], ["ended", "end"], ["loadstart", "source"]] as const) {
  test(`${event} discards pending/late PCM and delivers the old-epoch event before ending input`, async () => {
    const f = fixture();
    const handle = await f.input.open(f.target, f.identity);
    const events = handle.events[Symbol.asyncIterator]();
    await events.next();
    const late = f.processors[0].port.onmessage;
    f.pcm(); // Queued audio must be cleared, not delivered after the discontinuity.
    f.video.currentTime = 30;
    f.contexts[0].currentTime = 3;
    f.video.dispatchEvent(new Event(event));
    late?.({ data: { frame: 98048, pcm: new ArrayBuffer(8192) } });
    const changed = playback((await events.next()).value);
    assert.deepEqual(changed.identity, f.identity);
    assert.equal(changed.type, type);
    assert.equal(changed.sequence, 1);
    assert.equal(changed.anchor.monotonicMs, 3000);
    assert.equal(changed.anchor.mediaTimeMs, 30000);
    assert.equal((await events.next()).done, true);
    await handle.close();
    assert.equal(f.contexts[0].closes, 1);
    assert.equal(f.stops, 1);
  });
}

test("source retirement emits source, never resolves the replacement as the old target", async () => {
  const f = fixture();
  const handle = await f.input.open(f.target, f.identity);
  const events = handle.events[Symbol.asyncIterator]();
  await events.next();
  f.replace();
  assert.equal(playback((await events.next()).value).type, "source");
  assert.equal((await events.next()).done, true);
  assert.equal((await f.input.probe(f.target)).state, "unavailable");
  await handle.close();
});

test("same-session epoch restart waits for seeked, resets sample origin and emits a fresh clock anchor", async () => {
  const f = fixture();
  const first = await f.input.open(f.target, f.identity);
  const events = first.events[Symbol.asyncIterator]();
  const start = playback((await events.next()).value);
  f.video.seeking = true; f.video.readyState = 1;
  f.video.dispatchEvent(new Event("seeking"));
  assert.equal(playback((await events.next()).value).type, "seek");
  await first.close();
  f.activation.isActive = false;
  const nextIdentity = { ...f.identity, epoch: 1 };
  const opening = f.input.open(f.target, nextIdentity);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.captures, 1, "No capture while the selected video is seeking");
  f.video.currentTime = 30; f.video.seeking = false; f.video.readyState = 4;
  f.video.dispatchEvent(new Event("seeked"));
  const second = await opening;
  const next = second.events[Symbol.asyncIterator]();
  const resumed = playback((await next.next()).value);
  assert.deepEqual(resumed.identity, nextIdentity);
  assert.notEqual(resumed.anchor.clockId, start.anchor.clockId);
  assert.equal(resumed.anchor.mediaTimeMs, 30000);
  f.pcm();
  assert.deepEqual(audio((await next.next()).value).audioRange, { startMs: 0, endMs: 2048 / 48000 * 1000 });
  await second.close();
  await assert.rejects(f.input.open(f.target, { ...nextIdentity, sessionId: "other" }), /Start requires user activation/);
});

test("pagehide cancels waiting seek preparation and closes only owned resources", async () => {
  const f = fixture();
  f.video.seeking = true;
  const opening = f.input.open(f.target, f.identity);
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.view.dispatchEvent(new Event("pagehide"));
  await assert.rejects(opening, /target-invalidated/);
  assert.equal(f.captures, 0);
  assert.equal(f.contexts[0].closes, 1);
});

test("CORS-mode HTTP media is eligible, but a failed capture security check reports access denial and cleans up", async () => {
  const f = fixture();
  Object.assign(f.video, { currentSrc: "https://other.test/tone.webm", crossOrigin: "anonymous" });
  assert.deepEqual(await f.input.probe(f.target), { state: "available" });
  f.video.captureStream = () => { throw new DOMException("Not origin clean", "SecurityError"); };
  await assert.rejects(f.input.open(f.target, f.identity), /media-access-denied:/);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.processors.length, 0);
  // Failed preparation must release the active-session guard as well.
  await assert.rejects(f.input.open(f.target, f.identity), /media-access-denied:/);
  assert.equal(f.contexts[1].closes, 1);
});

test("foreign-frame, non-CORS, blob and protected routes are rejected before creating resources", async () => {
  const f = fixture();
  const foreign = await f.input.probe({ ...f.target, frameId: "other" });
  assert.ok("reason" in foreign); assert.equal(foreign.reason, "frame-permission-required");
  Object.assign(f.video, { currentSrc: "https://other.test/tone.webm", crossOrigin: null });
  const denied = await f.input.probe(f.target);
  assert.ok("reason" in denied); assert.equal(denied.reason, "media-access-denied");
  f.video.currentSrc = "blob:http://fixture.test/video";
  const blob = await f.input.probe(f.target);
  assert.ok("reason" in blob); assert.equal(blob.reason, "media-route-unknown");
  Object.assign(f.video, { mediaKeys: {} });
  const protectedMedia = await f.input.probe(f.target);
  assert.ok("reason" in protectedMedia); assert.equal(protectedMedia.reason, "protected-media");
  await assert.rejects(f.input.open(f.target, f.identity), /protected-media/);
  assert.equal(f.contexts.length, 0); assert.equal(f.captures, 0);
});
