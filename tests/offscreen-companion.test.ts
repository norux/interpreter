import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { CaptureCommand, CaptureStatus } from "../extension/capture/contracts";
import type { Caption } from "../extension/captions/contracts";
import { createPCMEncoder } from "../extension/capture/pcm";
import { defaultSettings } from "../extension/capture/settings";

test("legacy offscreen host routes PCM through combined adapter and preserves paired captions, settings and Stop ownership", async (t) => {
  let listener: (message: CaptureCommand, sender: chrome.runtime.MessageSender, respond: (status: CaptureStatus) => void) => void = () => {};
  const requests: RequestInit[] = [];
  const captions: Caption[] = [];
  const sockets: Socket[] = [];
  const worklets: Worklet[] = [];
  let trackStops = 0;
  let contextCloses = 0;
  let permissions = 0;
  class Socket {
    static CLOSED = 3;
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onopen?: () => void;
    onclose?: () => void;
    onerror?: () => void;
    onmessage?: (event: { data: string }) => void;
    packets: ArrayBuffer[] = [];
    closes = 0;
    constructor() { sockets.push(this); }
    send(value: unknown) { if (value instanceof ArrayBuffer) this.packets.push(value); }
    close() { this.closes++; this.readyState = 3; this.onclose?.(); }
    reply(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  class Worklet {
    port = { onmessage: undefined as ((event: { data: ArrayBuffer }) => void) | undefined, close() {} };
    constructor() { worklets.push(this); }
    connect() {}
    disconnect() {}
  }
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { async addModule() {} };
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async resume() {}
    async close() { contextCloses++; this.state = "closed"; }
  }
  const originals = new Map(["chrome", "fetch", "WebSocket", "AudioContext", "AudioWorkletNode"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const media = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const values = {
    WebSocket: Socket, AudioContext: Context, AudioWorkletNode: Worklet,
    fetch: async (_url: string, options: RequestInit) => { requests.push(options); return new Response(JSON.stringify({ sessionId: `fixture-${requests.length}`, token: "test-only" })); },
    chrome: { runtime: {
      id: "test", getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
      sendMessage: async (message: { type: string; caption?: Caption }) => {
        if (message.type === "stream-id") return "test-stream";
        if (message.caption) captions.push(message.caption);
      },
    } },
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { async getUserMedia() {
    permissions++;
    return { getTracks: () => [{ addEventListener() {}, removeEventListener() {}, stop() { trackStops++; } }] };
  } } });
  t.after(() => {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (media) Object.defineProperty(navigator, "mediaDevices", media);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });
  await import("../extension/offscreen");
  const command = (message: CaptureCommand) => new Promise<CaptureStatus>((resolve) => listener(message,
    { id: "test", url: "chrome-extension://test/service-worker.js" }, resolve));
  const selected = { ...defaultSettings, provider: "luna" as const, sourceLanguage: "en", targetLanguage: "ja", textModel: "existing-user-model" };
  const expected = { ...selected };
  const starting = command({ target: "offscreen", type: "start", tabId: 1, settings: selected });
  selected.targetLanguage = "ko";
  await setImmediate();
  assert.deepEqual(JSON.parse(requests[0].body as string), expected);
  assert.equal(permissions, 0);
  sockets[0].reply({ type: "ready", sessionId: "fixture-1" });
  assert.equal((await starting).state, "capturing");
  let packet!: ArrayBuffer;
  createPCMEncoder(24000, (value) => { packet = value; })([new Float32Array(480).fill(0.25)]);
  worklets[0].port.onmessage?.({ data: packet });
  await setImmediate();
  assert.deepEqual(new Uint8Array(sockets[0].packets[0]), new Uint8Array(packet));
  const caption = { sessionId: "fixture-1", utteranceId: "u", revision: 1, source: "generated English", translation: "generated Japanese",
    final: true, audioStartMs: 0, audioEndMs: 20, emittedAtMs: 77 };
  sockets[0].reply({ type: "caption", sessionId: "fixture-1", caption });
  await setImmediate();
  assert.equal(captions.length, 1);
  assert.equal(captions[0].framework?.version, 1, "Normalized records cross contexts in a version 1 envelope");
  const { framework, ...wire } = captions[0];
  const normalized = framework?.message.type === "paired-caption" ? framework.message.caption : undefined;
  assert.deepEqual(wire, caption, "Preserve all original wire caption fields and diagnostic timestamp");
  assert.equal(normalized?.source.language, "en");
  assert.deepEqual(normalized?.translation.state === "paired" && normalized.translation.revision.languages, { source: "en", target: "ja" });
  const late = sockets[0].onmessage;
  assert.equal((await command({ target: "offscreen", type: "stop" })).state, "idle");
  late?.({ data: JSON.stringify({ type: "caption", sessionId: "fixture-1", caption: { ...caption, revision: 2 } }) });
  await setImmediate();
  assert.equal(captions.length, 1);
  assert.equal(trackStops, 1);
  assert.equal(contextCloses, 1);
  assert.equal(sockets[0].closes, 1);

  const omitted = command({ target: "offscreen", type: "start", tabId: 1 });
  await setImmediate();
  assert.equal(requests[1].body, undefined, "Omitted settings continue using the server environment");
  sockets[1].reply({ type: "ready", sessionId: "fixture-2" });
  await omitted;
  sockets[1].reply({ type: "caption", sessionId: "fixture-2", caption: { ...caption, sessionId: "fixture-2" } });
  await setImmediate();
  const unknown = captions[1].framework?.message;
  assert.equal(unknown?.type === "paired-caption" && unknown.caption.source.language, "und", "Do not invent an environment-selected source language");
  await command({ target: "offscreen", type: "stop" });
  assert.equal(trackStops, 2);
  assert.equal(contextCloses, 2);
});
