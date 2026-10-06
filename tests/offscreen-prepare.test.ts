import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { CaptureCommand, CaptureStatus } from "../extension/capture/contracts";

test("preparation delays audio permission, surfaces model errors, and Stop rejects late ready", async (t) => {
  let listener: (message: CaptureCommand, sender: chrome.runtime.MessageSender, respond: (status: CaptureStatus) => void) => void = () => {};
  let permissionRequests = 0;
  let streamRequests = 0;
  const reports: CaptureStatus[] = [];
  const connections: Connection[] = [];
  class Connection {
    static CLOSED = 3;
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onclose?: () => void;
    onerror?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { connections.push(this); }
    send() {}
    close() { this.readyState = 3; this.onclose?.(); }
    reply(type: string, message = "") { this.onmessage?.({ data: JSON.stringify({ type, sessionId: "fixture", message }) }); }
  }
  const originals = new Map(["chrome", "WebSocket", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const media = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: async () => { permissionRequests++; throw new Error("Audio permission fixture"); },
  } });
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Connection });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => new Response(JSON.stringify({ sessionId: "fixture", token: "test-only" })) });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: { runtime: {
    id: "test", getURL: (path: string) => `chrome-extension://test/${path}`,
    onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
    sendMessage: async (message: { type: string; status?: CaptureStatus }) => {
      if (message.type === "stream-id") { streamRequests++; return "fresh-stream"; }
      if (message.status) reports.push(message.status);
    },
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
  const command = (type: "start" | "stop") => new Promise<CaptureStatus>((resolve) => listener(
    type === "start" ? { target: "offscreen", type, tabId: 1 } : { target: "offscreen", type },
    { id: "test", url: "chrome-extension://test/service-worker.js" }, resolve,
  ));
  const first = command("start");
  await setImmediate();
  assert.equal(reports.at(-1)?.state, "starting");
  assert.equal(permissionRequests, 0);
  assert.equal(streamRequests, 0);
  connections[0].reply("error", "Run ollama pull selected-model.");
  assert.equal((await first).message, "Run ollama pull selected-model.");
  assert.equal(permissionRequests, 0);

  const second = command("start");
  await setImmediate();
  const lateReady = connections[1].onmessage;
  assert.equal((await command("stop")).state, "idle");
  lateReady?.({ data: JSON.stringify({ type: "ready", sessionId: "fixture" }) });
  assert.equal((await second).state, "idle");
  assert.equal(streamRequests, 0);
  assert.equal(permissionRequests, 0);

  const third = command("start");
  await setImmediate();
  connections[2].reply("ready");
  assert.equal((await third).message, "Audio permission fixture");
  assert.equal(streamRequests, 1, "Acquire Chrome stream ID only after models are ready");
  assert.equal(permissionRequests, 1);
});
