import assert from "node:assert/strict";
import { test } from "node:test";
import type { MediaTargetId } from "../packages/contracts";
import { createRevisionStore } from "../packages/core/revision-store";
import { createCompanionCaptionBridge } from "../packages/engines-companion/captions";

const identity = { sessionId: "fixture", targetId: "legacy-tab-output" as MediaTargetId, epoch: 0 };
const languages = { source: "ja", target: "ko" };
const caption = { sessionId: "fixture", utteranceId: "u", revision: 1, source: "generated source", translation: "generated translation",
  final: false, audioStartMs: 0, audioEndMs: 20, emittedAtMs: 42 };

test("companion bridge observes source revisions independently and accepts complete pairs atomically", () => {
  const bridge = createCompanionCaptionBridge(identity, languages);
  const store = createRevisionStore(identity, 300);
  const accept = (value: typeof caption) => {
    const normalized = bridge.accept(value);
    assert.ok(normalized);
    assert.ok(store.accept({ type: "paired-caption", caption: normalized }));
    return normalized;
  };
  const first = accept(caption);
  assert.equal(first.source.sourceRevision, 1);
  const correction = accept({ ...caption, revision: 2, translation: "translation correction" });
  assert.equal(correction.source.sourceRevision, 1);
  assert.equal(correction.translation.state === "paired" && correction.translation.revision.translationRevision, 2);
  const source = accept({ ...caption, revision: 3, source: "source correction" });
  assert.equal(source.source.sourceRevision, 2);
  const final = accept({ ...caption, revision: 4, source: "source correction", final: true });
  assert.equal(final.source.sourceRevision, 3);
  assert.equal(final.translation.state === "paired" && final.translation.revision.sourceRevision, 3);
  assert.equal(final.source.language, "ja");
  assert.deepEqual(final.translation.state === "paired" && final.translation.revision.languages, languages);
  assert.equal(final.videoRange, undefined, "Tab elapsed time is not selected-video time");
  assert.equal(bridge.accept({ ...caption, revision: 5 }), undefined, "Final cannot regress");
  assert.equal(bridge.accept({ ...caption, revision: 3, final: true }), undefined);
  assert.equal(bridge.accept({ ...caption, revision: 4, final: true }), undefined);
  const range = accept({ ...caption, revision: 5, source: "source correction", final: true, audioEndMs: 40 });
  assert.equal(range.source.sourceRevision, 4, "Changed ranges remain consistent with atomic core acceptance");
});

test("companion caption boundary rejects malformed and foreign data without mutating accepted revisions", () => {
  const bridge = createCompanionCaptionBridge(identity, languages);
  for (const value of [null, {}, { ...caption, sessionId: "old" }, { ...caption, revision: NaN }, { ...caption, revision: 0 },
    { ...caption, source: 1 }, { ...caption, translation: {} }, { ...caption, final: "true" }, { ...caption, utteranceId: "" },
    { ...caption, audioStartMs: -1 }, { ...caption, audioEndMs: -1 }, { ...caption, emittedAtMs: Infinity }]) {
    assert.equal(bridge.accept(value), undefined);
  }
  assert.equal(bridge.accept(caption)?.source.sourceRevision, 1);
});

test("companion normalization retains at most 300 utterances and fences retired speech", () => {
  const bridge = createCompanionCaptionBridge(identity, languages);
  for (let index = 0; index < 301; index++) {
    assert.ok(bridge.accept({ ...caption, utteranceId: `u${index}`, audioStartMs: index * 20, audioEndMs: index * 20 + 20 }));
  }
  assert.equal(bridge.accept({ ...caption, utteranceId: "u0", revision: 2 }), undefined);
  assert.equal(bridge.accept({ ...caption, utteranceId: "u1", revision: 2, audioStartMs: 20, audioEndMs: 40 })?.source.sourceRevision, 1);
});

async function engineHarness() {
  const { createCompanionEngine, companionLimits } = await import("../packages/engines-companion/engine");
  const { createAudioQueue } = await import("../packages/core/audio-queue");
  const settings = { provider: "local" as const, asr: "local" as const, sourceLanguage: "ja", targetLanguage: "ko",
    asrModel: "existing-asr", textModel: "existing-text" };
  let receive: (reply: unknown) => void = () => {};
  let closes = 0;
  const packets: ArrayBuffer[] = [];
  const receipts: unknown[] = [];
  const engine = createCompanionEngine("fixture", {
    async prepare(callback) { receive = callback; },
    send(packet) { packets.push(packet); },
    async close() { closes++; },
  }, settings, (value) => receipts.push(value));
  settings.sourceLanguage = "en";
  const capabilities = await engine.probe(languages);
  assert.equal(capabilities.pipeline, "combined-interpretation");
  assert.equal(capabilities.asrOnlyUpdates, false);
  assert.deepEqual(capabilities.languages, languages, "Session settings are copied");
  assert.deepEqual(capabilities.models, [], "Protocol has no model version/load evidence");
  assert.equal((await engine.probe({ source: "en", target: "ko" })).availability.state, "unavailable");
  await engine.prepare(identity, languages);
  const queue = createAudioQueue(identity, companionLimits);
  const output = engine.run(queue.stream)[Symbol.asyncIterator]();
  return { engine, queue, output, packets, receipts, receive: (value: unknown) => receive(value), closes: () => closes };
}

test("combined companion engine preserves PCM1 bytes, emits only paired results and fences cancellation", async () => {
  const { createPCMEncoder } = await import("../extension/capture/pcm");
  const { decodeCompanionPCM } = await import("../packages/engines-companion/engine");
  const h = await engineHarness();
  const received = h.output.next();
  let packet!: ArrayBuffer;
  createPCMEncoder(24000, (value) => { packet = value; })([new Float32Array(480).fill(0.25)]);
  assert.equal(h.queue.push(decodeCompanionPCM(packet, identity)).state, "accepted");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.packets.length, 1);
  assert.deepEqual(new Uint8Array(h.packets[0]), new Uint8Array(packet));
  h.receive({ type: "caption", sessionId: "old", caption });
  h.receive({ type: "caption", sessionId: "fixture", caption });
  const event = (await received).value;
  assert.equal(event?.type, "paired-caption");
  h.receive({ type: "receipt", sessionId: "fixture", frames: 1, samples: 480, peak: 8192 });
  assert.deepEqual(h.receipts, [{ frames: 1, samples: 480, peak: 8192, droppedFrames: 0, droppedUtterances: 0 }]);
  h.receive({ type: "receipt", sessionId: "fixture", frames: "bad", samples: 480, peak: 0 });
  assert.equal(h.receipts.length, 1);
  await h.engine.cancel({ ...identity, epoch: 1 });
  assert.equal(h.closes(), 0, "Foreign epoch cancellation cannot close this engine");
  const waiting = h.output.next();
  await h.engine.cancel(identity);
  h.receive({ type: "caption", sessionId: "fixture", caption: { ...caption, revision: 2 } });
  assert.equal((await waiting).done, true);
  await h.engine.close();
  assert.equal(h.closes(), 1);
  const retired = await h.engine.probe(languages);
  assert.equal(retired.availability.state, "unavailable", "Closed legacy sessions require a fresh authenticated Start");
  h.queue.close();
});

test("companion engine bounds pending output and reports format/sequence failures instead of sending invalid audio", async () => {
  const h = await engineHarness();
  const started = h.output.next();
  for (let index = 0; index < 302; index++) h.receive({ type: "caption", sessionId: "fixture", caption: { ...caption, revision: index + 1 } });
  assert.equal((await started).value?.type, "status");
  assert.equal((await h.output.next()).done, true);
  assert.equal(h.closes(), 1);
  h.queue.close();

  const invalid = await engineHarness();
  const next = invalid.output.next();
  invalid.queue.push({ identity, scope: "tab-mix", sequence: 1, sampleRate: 24000, channels: 1, sampleFormat: "pcm-s16le",
    audioRange: { startMs: 20, endMs: 40 }, capture: { clockId: "fixture", startMs: 20, endMs: 40 }, pcm: new ArrayBuffer(960) });
  const error = (await next).value;
  assert.equal(error?.type === "status" && error.status.state, "failed");
  assert.match(error?.type === "status" ? error.status.message : "", /sequence/);
  assert.equal(invalid.packets.length, 0);
  await invalid.output.next();
  invalid.queue.close();
});

test("companion PCM decoding rejects invalid wire headers without claiming selected-video capture", async () => {
  const { createPCMEncoder } = await import("../extension/capture/pcm");
  const { decodeCompanionPCM } = await import("../packages/engines-companion/engine");
  let packet!: ArrayBuffer;
  createPCMEncoder(24000, (value) => { packet = value; })([new Float32Array(480)]);
  const chunk = decodeCompanionPCM(packet, identity);
  assert.equal(chunk.scope, "tab-mix");
  assert.equal(chunk.pcm.byteLength, 960);
  assert.throws(() => decodeCompanionPCM(new ArrayBuffer(0), identity));
  for (const offset of [0, 4, 8, 12, 20, 24, 26]) {
    const malformed = packet.slice(0);
    new DataView(malformed).setUint8(offset, 7);
    assert.throws(() => decodeCompanionPCM(malformed, identity));
  }
});

test("companion socket adapter preserves authentication, ready ordering, transport budget and owned close", async (t) => {
  const { createCompanionTransport } = await import("../packages/engines-companion/transport");
  const sockets: Socket[] = [];
  class Socket {
    static CLOSED = 3;
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    sent: unknown[] = [];
    closes = 0;
    constructor(url: string) { assert.equal(url, "ws://127.0.0.1:8765/audio"); sockets.push(this); }
    send(value: unknown) { this.sent.push(value); }
    close() { this.closes++; this.readyState = 3; this.onclose?.(); }
    reply(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket });
  t.after(() => { if (original) Object.defineProperty(globalThis, "WebSocket", original); else Reflect.deleteProperty(globalThis, "WebSocket"); });
  const controller = new AbortController();
  const transport = createCompanionTransport("fixture", "test-only", controller.signal);
  const replies: unknown[] = [];
  const preparation = transport.prepare((value) => replies.push(value));
  const socket = sockets[0];
  socket.onopen?.();
  assert.deepEqual(JSON.parse(socket.sent[0] as string), { sessionId: "fixture", token: "test-only" });
  socket.reply({ type: "ready", sessionId: "fixture" });
  await preparation;
  socket.reply({ type: "caption", sessionId: "fixture", caption });
  assert.equal(replies.length, 1);
  transport.send(new ArrayBuffer(988));
  socket.bufferedAmount = 49 * 988;
  transport.send(new ArrayBuffer(988));
  socket.bufferedAmount++;
  assert.throws(() => transport.send(new ArrayBuffer(988)), /backlog/);
  socket.onmessage?.({ data: "{" });
  assert.match((replies.at(-1) as { message: string }).message, /Invalid companion/);
  const late = socket.onmessage;
  await transport.close();
  late?.({ data: JSON.stringify({ type: "caption", sessionId: "fixture", caption }) });
  assert.equal(replies.length, 2, "Closed handlers reject even captured callbacks");
  await transport.close();
  assert.equal(socket.closes, 1);

  const pending = createCompanionTransport("fixture", "test-only", controller.signal);
  const waiting = pending.prepare(() => assert.fail("No events before ready"));
  const rejected = assert.rejects(waiting, /stopped during preparation/);
  controller.abort();
  await rejected;
  await pending.close();
  assert.equal(sockets[1].closes, 1);
});

test("legacy renderer accepts versioned companion pairs and rejects unsupported envelope versions", async () => {
  const { createLegacyPresentation } = await import("../extension/captions/presentation");
  const bridge = createCompanionCaptionBridge(identity, languages);
  const normalized = bridge.accept(caption);
  assert.ok(normalized);
  const rendered: unknown[] = [];
  const renderer = createLegacyPresentation("fixture", (event) => rendered.push(event));
  renderer.caption({ ...caption, framework: { version: 1, message: { type: "paired-caption", caption: normalized } } });
  assert.equal(rendered.length, 1);
  const other = bridge.accept({ ...caption, utteranceId: "other", audioStartMs: 40, audioEndMs: 60 });
  assert.ok(other);
  renderer.caption({ ...caption, framework: { version: 2 as 1, message: { type: "paired-caption", caption: other } } });
  renderer.caption({ ...caption, framework: { version: 1, message: { type: "transcript", revision: other.source } } });
  assert.equal(rendered.length, 1);
  renderer.dispose();
});
