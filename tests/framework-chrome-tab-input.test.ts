import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { createChromeTabInput } from "../apps/chrome/tab-input";
import { createTimeline } from "../packages/core/timeline";

// Cancellation/ownership mocks only; real tab PCM/output uses the headed harness.
function fixture(t: TestContext) {
  const listeners = new Set<(...args: unknown[]) => void>();
  const event = { addListener(listener: (...args: unknown[]) => void) { listeners.add(listener); }, removeListener(listener: (...args: unknown[]) => void) { listeners.delete(listener); } };
  let resolveMedia: (stream: unknown) => void = () => {};
  let resolveModule: () => void = () => {};
  let delayMedia = false;
  let delayModule = false;
  let stops = 0;
  let closes = 0;
  const track = Object.assign(new EventTarget(), { stop() { stops++; } });
  const stream = { active: true, getTracks: () => [track] };
  const processors: { port: { onmessage: ((event: { data: { frame: number; pcm: ArrayBuffer } }) => void) | null } }[] = [];
  const globals = {
    window: new EventTarget(),
    chrome: { tabs: { onUpdated: event, onRemoved: event }, tabCapture: { async getMediaStreamId(options: unknown) { assert.deepEqual(options,{targetTabId:12}); return "id"; } } },
    navigator: { mediaDevices: { async getUserMedia(options: unknown) {
      assert.deepEqual(options,{audio:{mandatory:{chromeMediaSource:"tab",chromeMediaSourceId:"id"}},video:false});
      return delayMedia ? new Promise(resolve => { resolveMedia = resolve; }) : stream;
    } } },
    AudioContext: class {
      sampleRate = 48000; state = "suspended"; destination = {};
      audioWorklet = { async addModule() { if(delayModule) await new Promise<void>(resolve => {resolveModule = resolve;}); } };
      createMediaStreamSource() { return {connect() {},disconnect() {}}; }
      async resume() { this.state = "running"; }
      async close() { this.state = "closed";closes++; }
    },
    AudioWorkletNode: class {
      port = { onmessage: null as ((event: { data: { frame: number; pcm: ArrayBuffer } }) => void) | null, close() {} };
      constructor() { processors.push(this); }
      connect() {} disconnect() {}
    },
  };
  const restore: (() => void)[] = [];
  for(const [key,value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true});
    restore.push(() => { if(previous) Object.defineProperty(globalThis,key,previous);else Reflect.deleteProperty(globalThis,key); });
  }
  const interruptions: string[] = [];
  const capture = createChromeTabInput(12,"worklet.js",{maxChunkBytes:8192,maxAudioQueueMs:100},reason => interruptions.push(reason));
  t.after(async () => { await capture.dispose(); for(const reset of restore) reset(); });
  return { capture, interruptions, processors, listeners, track,
    delayMedia() { delayMedia = true; }, deliverMedia() { resolveMedia(stream); },
    delayModule() { delayModule = true; }, deliverModule() { resolveModule(); },
    get stops() { return stops; }, get closes() { return closes; },
  };
}

test("Stop during pending acquisition stops a late stream without creating playback resources", async t => {
  const f = fixture(t); f.delayMedia();
  const pending = f.capture.capture(); await new Promise(done => setImmediate(done));
  await f.capture.stop(); f.deliverMedia(); await assert.rejects(pending,/cancelled/);
  assert.equal(f.stops,1);assert.equal(f.closes,0);
  assert.notEqual((await f.capture.input.probe(f.capture.target)).state,"available");
});

test("Stop during worklet loading retires its input and cannot restart capture", async t => {
  const f = fixture(t); await f.capture.capture(); f.delayModule();
  const pending = f.capture.input.open(f.capture.target,{sessionId:"session",targetId:f.capture.target.id,epoch:0});
  await f.capture.stop(); f.deliverModule(); await assert.rejects(pending,/cancelled/);
  assert.equal(f.stops,1);assert.equal(f.closes,1);assert.equal(f.processors.length,0);
});

test("tab PCM uses elapsed capture time with no video anchor and cannot survive its owner's Stop", async t => {
  const f = fixture(t);await f.capture.capture();
  const identity = {sessionId:"session",targetId:f.capture.target.id,epoch:0};
  const handle = await f.capture.input.open(f.capture.target,identity);
  const late = f.processors[0].port.onmessage;
  late?.({data:{frame:96000,pcm:new ArrayBuffer(8192)}});
  const iterator = handle.events[Symbol.asyncIterator]();
  const chunk = (await iterator.next()).value; assert.ok(chunk && !("type" in chunk));
  assert.equal(chunk.scope,"tab-mix");assert.equal(chunk.audioRange.startMs,0);assert.equal(chunk.capture.startMs,2000);
  const timeline = createTimeline(identity);assert.equal(timeline.audio(chunk),"accepted");assert.equal(timeline.map(chunk.audioRange),undefined);
  const next = iterator.next();await handle.close();late?.({data:{frame:98048,pcm:new ArrayBuffer(8192)}});
  assert.equal((await next).done,true);assert.equal((await iterator.next()).done,true);
  await handle.close();assert.equal(f.stops,1);assert.equal(f.closes,1);
});
