import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { CaptureCommand, CaptureStatus } from "../extension/capture/contracts";

test("terminal offscreen reports release its document without clearing errors or a restarted capture", async (t) => {
  let status: CaptureStatus = { state: "idle", message: "Captured tab closed or audio ended." };
  let documentOpen = true;
  let saved: CaptureStatus | undefined;
  const cleared: string[] = [];
  let listener: (message: CaptureCommand, sender: chrome.runtime.MessageSender, respond: () => void) => void = () => {};
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: {
      id: "test-extension",
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      getContexts: async () => documentOpen ? [{}] : [],
      sendMessage: async () => status,
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
    },
    storage: { session: {
      set: async (value: { captureStatus: CaptureStatus }) => { saved = value.captureStatus; },
      get: async () => ({ captureStatus: saved }),
    } },
    offscreen: { closeDocument: async () => { documentOpen = false; } },
    tabs: { sendMessage: async (_tabId: number, message: { sessionId: string }) => { cleared.push(message.sessionId); }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "chrome", original);
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  await import("../extension/service-worker");
  const report = async (reported: CaptureStatus) => {
    listener({ target: "worker", type: "capture-status", status: reported }, {
      id: "test-extension", url: "chrome-extension://test-extension/offscreen.html",
    }, () => {});
    await setImmediate();
  };
  await report(status);
  assert.equal(documentOpen, false, "Ended tab must not leave an offscreen document alive");
  assert.deepEqual(saved, status);

  documentOpen = true;
  saved = { state: "capturing", tabId: 1, sessionId: "disconnected-session", message: "Capturing" };
  status = { state: "error", message: "Companion disconnected. Start again to reconnect." };
  await report(status);
  assert.equal(documentOpen, false, "Disconnected capture must release its document");
  assert.deepEqual(saved, status, "Cleanup must preserve the actionable error");
  assert.deepEqual(cleared, ["disconnected-session"], "Disconnect must clear the previous caption session");

  documentOpen = true;
  status = { state: "capturing", tabId: 2, sessionId: "new-session", message: "New capture" };
  saved = status;
  await report({ state: "idle", message: "Old capture stopped" });
  assert.equal(documentOpen, true, "Queued terminal report must not close a new capture");
  assert.deepEqual(cleared, ["disconnected-session"], "Late terminal report must not clear the new caption session");
});
