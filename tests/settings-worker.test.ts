import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { CaptureCommand, CaptureStatus } from "../extension/capture/contracts";
import { defaultSettings, type SessionSettings } from "../extension/capture/settings";

test("popup configuration stops the old session, persists selection and routes only the new session", async (t) => {
  let status: CaptureStatus = { state: "idle", message: "Ready" };
  let documentOpen = false;
  let settings: SessionSettings | undefined;
  let count = 0;
  let preparing = false;
  let releasePreparation: ((status: CaptureStatus) => void) | undefined;
  const messages: unknown[] = [];
  const starts: SessionSettings[] = [];
  let listener: (message: CaptureCommand, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => void = () => {};
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: {
      id: "test", getURL: (path: string) => `chrome-extension://test/${path}`,
      ContextType: { OFFSCREEN_DOCUMENT: "offscreen" }, getContexts: async () => documentOpen ? [{}] : [],
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
      sendMessage: async (message: { type: string; settings: SessionSettings }) => {
        if (message.type === "start") {
          if (preparing) {
            status = { state: "starting", tabId: 1, message: "Preparing" };
            return new Promise<CaptureStatus>((resolve) => { releasePreparation = resolve; });
          }
          starts.push(message.settings);
          status = { state: "capturing", tabId: 1, sessionId: `session-${++count}`, message: "Listening" };
        } else if (message.type === "stop") {
          status = { state: "idle", message: "Stopped" };
          releasePreparation?.(status);
          releasePreparation = undefined;
        }
        return status;
      },
    },
    storage: {
      session: { get: async () => ({ captureStatus: status }), set: async (value: { captureStatus: CaptureStatus }) => { status = value.captureStatus; } },
      local: { get: async () => ({ sessionSettings: settings }), set: async (value: { sessionSettings: SessionSettings }) => { settings = value.sessionSettings; } },
    },
    offscreen: { Reason: { USER_MEDIA: "USER_MEDIA" }, createDocument: async () => { documentOpen = true; }, closeDocument: async () => { documentOpen = false; } },
    tabCapture: { getMediaStreamId: async () => "fixture-stream-id" },
    scripting: { executeScript: async () => {} },
    tabs: { query: async () => [{ id: 1, url: "http://127.0.0.1/fixture" }], sendMessage: async (_id: number, message: unknown) => { messages.push(message); }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "chrome", original); else Reflect.deleteProperty(globalThis, "chrome"); });
  await import("../extension/service-worker");
  const popup = (message: CaptureCommand) => new Promise<unknown>((resolve) => listener(message, { id: "test", url: "chrome-extension://test/popup.html" }, resolve));
  assert.deepEqual(await popup({ target: "worker", type: "settings" }), defaultSettings);
  await popup({ target: "worker", type: "start" });
  assert.equal(status.sessionId, "session-1");
  const next = { ...defaultSettings, provider: "luna" as const, textModel: "gpt-6-luna", targetLanguage: "ja" };
  listener({ target: "worker", type: "configure", settings: next }, { id: "test", url: "chrome-extension://test/content.js" }, () => {});
  await setImmediate();
  assert.equal(status.state, "capturing", "Content script cannot select a provider or stop recording");
  await popup({ target: "worker", type: "configure", settings: next });
  assert.equal(documentOpen, false);
  assert.equal(status.state, "idle");
  assert.deepEqual(await popup({ target: "worker", type: "settings" }), next);
  assert.ok(messages.some((message) => JSON.stringify(message).includes('"clear","sessionId":"session-1"')));
  await popup({ target: "worker", type: "start" });
  assert.deepEqual(starts, [defaultSettings, next]);
  const caption = { sessionId: "session-1", utteranceId: "u", revision: 1, source: "", translation: "old", final: true, audioStartMs: 0, audioEndMs: 1, emittedAtMs: 2 };
  for (const sessionId of ["session-1", "session-2"]) {
    listener({ target: "worker", type: "caption", caption: { ...caption, sessionId } }, { id: "test", url: "chrome-extension://test/offscreen.html" }, () => {});
  }
  await setImmediate();
  const delivered = messages.filter((message) => (message as { type: string }).type === "caption");
  assert.equal(delivered.length, 1);
  assert.equal((delivered[0] as { caption: { sessionId: string } }).caption.sessionId, "session-2");
  await popup({ target: "worker", type: "stop" });
  assert.equal(documentOpen, false);
  preparing = true;
  for (const type of ["stop", "configure"] as const) {
    const starting = popup({ target: "worker", type: "start" });
    await setImmediate();
    assert.equal(status.state, "starting");
    await popup(type === "stop" ? { target: "worker", type } : { target: "worker", type, settings: next });
    await starting;
    assert.equal(status.state, "idle", "Stop and provider changes must interrupt pending Start");
    assert.equal(documentOpen, false);
  }
});
