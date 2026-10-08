import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioChunk, MediaTarget, SessionIdentity, VideoInput } from "../packages/contracts";
import { createRemoteVideoInput, serveVideoInput } from "../apps/chrome/channel";

const channelWindow = 4;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object"; }
function wire(event: AudioChunk) { return { ...event, pcm: Buffer.from(event.pcm).toString("base64") }; }
const target = { id: "selected", documentId: "document", frameId: "0" } as MediaTarget;
const identity: SessionIdentity = { sessionId: "session", targetId: target.id, epoch: 0 };
function chunk(sequence = 0): AudioChunk {
  return { identity, scope: "selected-video", sequence, channels: 1, sampleRate: 16000, sampleFormat: "pcm-f32le",
    audioRange: { startMs: sequence * 128, endMs: (sequence + 1) * 128 },
    capture: { clockId: "clock", startMs: 100 + sequence * 128, endMs: 100 + (sequence + 1) * 128 }, pcm: new Float32Array(2048).fill(0.1).buffer };
}
const play = { identity, sequence: 0, type: "play" as const, anchor: { clockId: "clock", monotonicMs: 100, mediaTimeMs: 12000, playbackRate: 1 } };
function ports() {
  function make() {
    const messages = new Set<(message: unknown) => void>(); const disconnects = new Set<() => void>();
    return { messages, disconnects, sent: [] as unknown[], onMessage: { addListener: (fn: (message: unknown) => void) => messages.add(fn), removeListener: (fn: (message: unknown) => void) => messages.delete(fn) },
      onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn), removeListener: (fn: () => void) => disconnects.delete(fn) },
      postMessage(_value: unknown) {}, disconnect() {} };
  }
  const host = make(), page = make(); let disconnected = false;
  for (const [from, to] of [[host, page], [page, host]]) {
    from.postMessage = value => { if (disconnected) throw new Error("disconnected"); from.sent.push(value);
      const json = JSON.parse(JSON.stringify(value)); queueMicrotask(() => { for (const fn of to.messages) fn(json); }); };
    from.disconnect = () => { if (disconnected) return; disconnected = true; for (const fn of [...host.disconnects, ...page.disconnects]) fn(); };
  }
  return { host, page, hostPort: host as unknown as chrome.runtime.Port, pagePort: page as unknown as chrome.runtime.Port };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test("Chrome JSON boundary rejects malformed PCM, identity, scope and timing", async () => {
  const encoded = wire(chunk());
  for (const invalid of [
    { ...encoded, identity: { ...identity, epoch: 1 } }, { ...encoded, sequence: -1 }, { ...encoded, scope: "tab-mix" },
    { ...encoded, pcm: "A".repeat(10928) }, { ...encoded, pcm: "!!!!" }, { ...encoded, channels: 2 },
    { ...encoded, audioRange: { startMs: 0, endMs: 100 } }, { ...encoded, capture: null },
    { ...encoded, pcm: Buffer.from(new Float32Array([NaN]).buffer).toString("base64") },
    { ...play, anchor: { ...play.anchor, clockId: "" } },
  ]) {
    const pair = ports(); const remote = createRemoteVideoInput(pair.hostPort);
    const opened = remote.input.open(target, identity); await tick();
    pair.page.postMessage({ version: 1, type: "reply", requestId: "1", result: "opened" }); const handle = await opened;
    pair.page.postMessage({ version: 1, type: "event", streamId: "1", number: 0, event: play }); await tick();
    const iterator = handle.events[Symbol.asyncIterator](); await iterator.next();
    const next = iterator.next();
    pair.page.postMessage({ version: 1, type: "event", streamId: "1", number: 1, event: invalid });
    await assert.rejects(next, /audio-gap/); remote.dispose();
  }
});

test("direct page channel consumes only acknowledged bounded packets and preserves video mapping", async () => {
  const pair = ports(); let start: (() => void) | undefined; let closed = 0;
  const input: VideoInput = { probe: async () => ({ state: "available" }), open: async () => ({
    close: async () => { closed++; }, events: { async *[Symbol.asyncIterator]() { yield play; for (let i = 0; i < 12; i++) yield chunk(i); } },
  }) };
  const server = serveVideoInput(pair.pagePort, input, { discover: async () => [], subscribe: () => () => {} }, callback => { start = callback; return () => {}; });
  const remote = createRemoteVideoInput(pair.hostPort);
  const opened = remote.input.open(target, identity); await tick(); assert.ok(start); start();
  const handle = await opened; await tick();
  assert.equal(pair.page.sent.filter(item => record(item) && item.type === "event").length, channelWindow);
  const iterator = handle.events[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, play);
  const samples = [];
  for (let i = 0; i < 12; i++) samples.push((await iterator.next()).value as AudioChunk);
  assert.deepEqual(samples.map(sample => sample.sequence), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(samples.every(sample => sample.pcm.byteLength === 8192), true);
  for (const sample of samples) assert.deepEqual(new Uint8Array(sample.pcm), new Uint8Array(chunk(sample.sequence).pcm));
  assert.equal((await iterator.next()).done, true);
  await handle.close(); remote.dispose(); server.dispose(); assert.ok(closed);
});

test("Stop before the page gesture cancels open without ever acquiring PCM", async () => {
  const pair = ports(); let start: (() => void) | undefined; let acquisitions = 0; let removed = false;
  const input: VideoInput = { probe: async () => ({ state: "available" }), async open() { acquisitions++; throw new Error("must not open"); } };
  const server = serveVideoInput(pair.pagePort, input, { discover: async () => [], subscribe: () => () => {} }, callback => { start = callback; return () => { removed = true; }; });
  const remote = createRemoteVideoInput(pair.hostPort);
  const opened = remote.input.open(target, identity); await tick(); remote.stop();
  await assert.rejects(opened, /cancelled/); await tick(); assert.ok(start); start(); await tick();
  assert.equal(acquisitions, 0); assert.equal(removed, true); remote.dispose(); server.dispose();
});

test("foreign stream IDs are ignored while sequence gaps fail without accepting audio", async () => {
  const pair = ports(); const remote = createRemoteVideoInput(pair.hostPort);
  const opened = remote.input.open(target, identity); await tick();
  pair.page.postMessage({ version: 1, type: "reply", requestId: "1", result: "opened" }); const handle = await opened;
  pair.page.postMessage({ version: 1, type: "event", streamId: "retired", number: 0, event: play }); await tick();
  const next = handle.events[Symbol.asyncIterator]().next();
  pair.page.postMessage({ version: 1, type: "event", streamId: "1", number: 1, event: wire(chunk()) });
  await assert.rejects(next, /sequence gap/); remote.dispose();
});

test("withheld acknowledgements close page capture with explicit audio loss", async () => {
  const pair = ports(); let start: (() => void) | undefined; let closed = false;
  const errors: string[] = [];
  pair.host.messages.add(message => { if (record(message) && message.type === "end" && typeof message.error === "string") errors.push(message.error); });
  const server = serveVideoInput(pair.pagePort, { probe: async () => ({ state: "available" }), open: async () => ({
    close: async () => { closed = true; }, events: { async *[Symbol.asyncIterator]() { yield play; for (let i = 0; i < 8; i++) yield chunk(i); } },
  }) }, { discover: async () => [], subscribe: () => () => {} }, callback => { start = callback; return () => {}; });
  pair.host.postMessage({ version: 1, type: "open", requestId: "1", target, identity }); await tick(); assert.ok(start); start();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(pair.page.sent.filter(item => record(item) && item.type === "event").length, channelWindow);
  assert.match(errors[0], /audio-gap: Page acknowledgements stalled/); assert.equal(closed, true); server.dispose();
});
