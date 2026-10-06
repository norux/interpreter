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
  let downloaded: string | undefined;
  let downloadId: number | undefined;
  let transcriptWindowId: number | undefined;
  let windowCreates = 0;
  let windowFocuses = 0;
  let windowClosed = false;
  const transcriptMessages: unknown[] = [];
  let downloadChanged: (value: { id: number; state: { current: string } }) => void = () => {};
  const messages: unknown[] = [];
  const starts: SessionSettings[] = [];
  let listener: (message: CaptureCommand, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => void = () => {};
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"status":"ok"}');
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: {
      id: "test", getURL: (path: string) => `chrome-extension://test/${path}`,
      ContextType: { OFFSCREEN_DOCUMENT: "offscreen" }, getContexts: async () => documentOpen ? [{}] : [],
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
      sendMessage: async (message: { target: string; type: string; settings: SessionSettings }) => {
        if (message.target === "transcript") { transcriptMessages.push(structuredClone(message)); return; }
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
      session: {
        get: async () => ({ captureStatus: status, companionDownloadId: downloadId, transcriptWindowId }),
        set: async (value: { captureStatus?: CaptureStatus; companionDownloadId?: number; transcriptWindowId?: number }) => {
          if (value.captureStatus) status = value.captureStatus;
          if (value.companionDownloadId !== undefined) downloadId = value.companionDownloadId;
          if (value.transcriptWindowId !== undefined) transcriptWindowId = value.transcriptWindowId;
        },
        remove: async () => { downloadId = undefined; },
      },
      local: { get: async () => ({ sessionSettings: settings }), set: async (value: { sessionSettings: SessionSettings }) => { settings = value.sessionSettings; } },
    },
    offscreen: { Reason: { USER_MEDIA: "USER_MEDIA" }, createDocument: async () => { documentOpen = true; }, closeDocument: async () => { documentOpen = false; } },
    downloads: { onChanged: { addListener: (callback: typeof downloadChanged) => { downloadChanged = callback; } }, download: async ({ url }: { url: string }) => { downloaded = url; return 1; } },
    windows: {
      create: async ({ url }: { url: string }) => { assert.equal(url, "chrome-extension://test/transcript.html"); windowCreates++; return { id: windowCreates }; },
      update: async (id: number) => { assert.equal(id, transcriptWindowId); if (windowClosed) throw new Error("Closed window"); windowFocuses++; },
    },
    tabCapture: { getMediaStreamId: async () => "fixture-stream-id" },
    scripting: { executeScript: async () => {} },
    tabs: { query: async () => [{ id: 1, url: "http://127.0.0.1/fixture" }], sendMessage: async (_id: number, message: unknown) => { messages.push(message); }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
  } });
  t.after(() => { globalThis.fetch = originalFetch; if (original) Object.defineProperty(globalThis, "chrome", original); else Reflect.deleteProperty(globalThis, "chrome"); });
  await import("../extension/service-worker");
  const popup = (message: CaptureCommand) => new Promise<unknown>((resolve) => listener(message, { id: "test", url: "chrome-extension://test/popup.html" }, resolve));
  assert.deepEqual(await popup({ target: "worker", type: "settings" }), defaultSettings);
  await popup({ target: "worker", type: "start" });
  assert.equal(status.sessionId, "session-1");
  assert.equal(windowCreates, 1, "Start opens the source/time/translation comparison window");
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
  assert.equal(windowCreates, 1, "A subsequent Start reuses the comparison window");
  assert.equal(windowFocuses, 1);
  const snapshot = () => new Promise<{ sessionId: string; captions: typeof caption[]; dropped: number }>((resolve) => listener(
    { target: "worker", type: "transcript-snapshot" }, { id: "test", url: "chrome-extension://test/transcript.html" }, resolve as (value: unknown) => void,
  ));
  assert.deepEqual((await snapshot()).captions.map((item) => item.sessionId), ["session-2"]);
  for (const item of [
    { ...caption, sessionId: "session-2", revision: 2, source: "新しい原文", translation: "새 번역" },
    { ...caption, sessionId: "session-2", revision: 1, translation: "stale" },
    { ...caption, sessionId: "session-2", revision: 3, final: false, translation: "late partial" },
  ]) listener({ target: "worker", type: "caption", caption: item }, { id: "test", url: "chrome-extension://test/offscreen.html" }, () => {});
  await setImmediate();
  assert.equal((await snapshot()).captions[0].source, "新しい原文");
  assert.equal((await snapshot()).captions[0].translation, "새 번역", "Replay preserves the latest final pair, rejecting older revisions and late partials");
  for (let i = 1; i <= 300; i++) listener({ target: "worker", type: "caption", caption: { ...caption, sessionId: "session-2", utteranceId: `u-${i}`, audioStartMs: i * 1000 } }, { id: "test", url: "chrome-extension://test/offscreen.html" }, () => {});
  for (let i = 0; i < 310; i++) await setImmediate();
  assert.equal((await snapshot()).captions.length, 300);
  assert.equal((await snapshot()).dropped, 1);
  assert.ok(transcriptMessages.some((message) => (message as { removedId?: string }).removedId === "u"));
  listener({ target: "worker", type: "open-transcript" }, { id: "test", url: "chrome-extension://test/content.js" }, () => {});
  await setImmediate();
  assert.equal(windowFocuses, 1, "A page cannot open the comparison window");
  await popup({ target: "worker", type: "open-transcript" });
  assert.equal(windowFocuses, 2);
  windowClosed = true;
  await popup({ target: "worker", type: "open-transcript" });
  assert.equal(windowCreates, 2, "Reopen creates a new window after the user closes the old one");
  await popup({ target: "worker", type: "stop" });
  assert.equal(documentOpen, false);
  assert.equal((await snapshot()).captions.length, 300, "Stop retains the recent in-memory pairs for review");
  preparing = true;
  for (const type of ["stop", "configure"] as const) {
    const starting = popup({ target: "worker", type: "start" });
    await setImmediate();
    assert.equal(status.state, "starting");
    await popup(type === "stop" ? { target: "worker", type } : { target: "worker", type, settings: next });
    await starting;
    assert.equal(status.state, "idle", "Stop and provider changes must interrupt pending Start");
    assert.equal(documentOpen, false);
    assert.equal((await snapshot()).captions.length, 0, "A new Start clears the previous transcript even if preparation is cancelled");
  }
  listener({ target: "worker", type: "install-companion" }, { id: "test", url: "chrome-extension://test/content.js" }, () => {});
  await setImmediate();
  assert.equal(downloaded, undefined, "A content script cannot download an installer");
  await popup({ target: "worker", type: "install-companion" });
  assert.equal(downloaded, "https://github.com/norux/interpreter/releases/latest/download/Interpreter-Companion-macos-arm64.dmg");
  downloadChanged({ id: 1, state: { current: "interrupted" } });
  await setImmediate();
  assert.equal(status.installRequired, true, "A late HTTP/download failure must remain actionable after the popup closes");
  assert.equal(status.state, "error");
});
