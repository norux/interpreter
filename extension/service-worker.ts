import type { CaptureCommand, CaptureStatus } from "./capture/contracts";

import { defaultSettings, type SessionSettings } from "./capture/settings";
import { createCompanionConnection } from "./companion";

async function readSettings(): Promise<SessionSettings> {
  const saved = await chrome.storage.local.get("sessionSettings") as { sessionSettings?: SessionSettings };
  return saved.sessionSettings ?? defaultSettings;
}

const idle: CaptureStatus = { state: "idle", message: "Ready to capture tab audio." };
let operations = Promise.resolve();
let startGeneration = 0;
const companion = createCompanionConnection((message) => {
  void interruptStart().then(() => enqueue(async () => {
    await stopCapture();
    const next: CaptureStatus = { state: "error", message };
    await chrome.storage.session.set({ captureStatus: next });
    return next;
  }));
});

async function interruptStart() {
  startGeneration++;
  companion.cancelStart();
  if ((await readStatus()).state === "starting" && await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
  }
}

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length > 0;
}

async function readStatus(): Promise<CaptureStatus> {
  if (await hasOffscreen()) return chrome.runtime.sendMessage({ target: "offscreen", type: "status" });
  const saved = await chrome.storage.session.get("captureStatus") as { captureStatus?: CaptureStatus };
  return saved.captureStatus ?? idle;
}

async function clearCaptions(status: CaptureStatus) {
  if (status.tabId && status.sessionId) {
    await chrome.tabs.sendMessage(status.tabId, { target: "captions", type: "clear", sessionId: status.sessionId }).catch(() => {});
  }
}

async function stopCapture(): Promise<CaptureStatus> {
  await clearCaptions(await readStatus());
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
    await chrome.offscreen.closeDocument();
  }
  await companion.stop();
  await chrome.storage.session.set({ captureStatus: idle });
  return idle;
}

async function startCapture(): Promise<CaptureStatus> {
  const started = startGeneration;
  await stopCapture();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    const next: CaptureStatus = { state: "error", message: "Open an ordinary HTTP/HTTPS page with audio. Chrome internal pages cannot be captured." };
    await chrome.storage.session.set({ captureStatus: next });
    return next;
  }
  await chrome.storage.session.set({ captureStatus: { state: "starting", tabId: tab.id, message: "Starting tab capture…" } });
  try {
    const settings = await readSettings();
    await chrome.storage.session.set({ captureStatus: { state: "starting", tabId: tab.id, message: "Starting Interpreter Companion…" } });
    await companion.start(settings.provider === "local");
    if (started !== startGeneration) return stopCapture();
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capture user-selected tab audio and preserve its original playback.",
    });
    if (started !== startGeneration) return stopCapture();
    const next: CaptureStatus = await chrome.runtime.sendMessage({ target: "offscreen", type: "start", tabId: tab.id, settings });
    if (started !== startGeneration) return stopCapture();
    if (next.state === "capturing" && next.sessionId) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, { target: "captions", type: "start", sessionId: next.sessionId });
    }
    if (next.state === "error") { await chrome.offscreen.closeDocument(); await companion.stop(); }
    await chrome.storage.session.set({ captureStatus: next });
    return next;
  } catch (error) {
    await stopCapture();
    if (started !== startGeneration) return idle;
    const next: CaptureStatus = { state: "error", message: error instanceof Error ? error.message : "Tab capture failed." };
    if (error instanceof Error && "installRequired" in error && error.installRequired) next.installRequired = true;
    await chrome.storage.session.set({ captureStatus: next });
    return next;
  }
}

function enqueue(task: () => Promise<CaptureStatus>): Promise<CaptureStatus> {
  const result = operations.then(task);
  operations = result.then(() => {}, () => {});
  return result;
}

chrome.runtime.onMessage.addListener((message: CaptureCommand, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== "worker") return;
  if (message.type === "stream-id") {
    if (sender.url !== chrome.runtime.getURL("offscreen.html")) return;
    void readStatus().then(async (current) => current.state === "starting" && current.tabId === message.tabId
      ? chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId }) : "").then(respond, () => respond(""));
    return true;
  }
  if (message.type === "caption") {
    if (sender.url !== chrome.runtime.getURL("offscreen.html")) return;
    void enqueue(async () => {
      const current = await readStatus();
      if (current.state === "capturing" && current.sessionId === message.caption.sessionId && current.tabId) {
        await chrome.tabs.sendMessage(current.tabId, { target: "captions", type: "caption", caption: message.caption }).catch(() => {});
      }
      return current;
    });
    return;
  }
  if (message.type === "capture-status") {
    if (sender.url === chrome.runtime.getURL("offscreen.html")) {
      const previous = message.status.state === "idle" || message.status.state === "error"
        ? chrome.storage.session.get<{ captureStatus?: CaptureStatus }>("captureStatus")
        : undefined;
      void chrome.storage.session.set({ captureStatus: message.status });
      if (message.status.state === "idle" || message.status.state === "error") {
        void enqueue(async () => {
          // A terminal report can race with tab removal or a new Start operation.
          const current = await readStatus();
          if (current.state === "idle" || current.state === "error") {
            const saved = await previous;
            if (saved?.captureStatus) await clearCaptions(saved.captureStatus);
            if (await hasOffscreen()) await chrome.offscreen.closeDocument();
            await companion.stop();
            await chrome.storage.session.set({ captureStatus: current });
          }
          return current;
        });
      }
    }
    return;
  }
  // Only the extension popup can initiate recording; page/content messages cannot.
  if (sender.url !== chrome.runtime.getURL("popup.html")) return;
  if (message.type === "install-companion") {
    void chrome.downloads.download({
      url: "https://github.com/norux/interpreter/releases/latest/download/Interpreter-Companion-macos-arm64.dmg",
      saveAs: true,
    }).then(async (downloadId) => {
      await chrome.storage.session.set({ companionDownloadId: downloadId });
      respond({ state: "idle", message: "Downloading the installer. When complete, move the app to Applications, open it and prepare the models." });
    },
      () => respond({ state: "error", installRequired: true, message: "Companion download failed. A GitHub release may not be available yet; use the local installer." }));
    return true;
  }
  if (message.type === "settings") {
    void readSettings().then(respond);
    return true;
  }
  if (message.type === "configure") {
    void interruptStart().then(() => enqueue(async () => {
      const next = await stopCapture();
      await chrome.storage.local.set({ sessionSettings: message.settings });
      return next;
    })).then(respond);
    return true;
  }
  const task = message.type === "status" ? readStatus() : message.type === "start"
    ? enqueue(startCapture) : interruptStart().then(() => enqueue(stopCapture));
  void task.then(respond, (error) => respond({ state: "error", message: String(error) }));
  return true;
});

chrome.downloads.onChanged.addListener((download) => {
  if (download.state?.current !== "interrupted" && download.state?.current !== "complete") return;
  void chrome.storage.session.get<{ companionDownloadId?: number }>("companionDownloadId").then(async (saved) => {
    if (saved.companionDownloadId !== download.id) return;
    await chrome.storage.session.remove("companionDownloadId");
    const current = await readStatus();
    if (current.state === "starting" || current.state === "capturing") return;
    const next: CaptureStatus = download.state?.current === "interrupted"
      ? { state: "error", installRequired: true, message: "Companion download failed. A GitHub release may not be available yet; use the local installer." }
      : { state: "idle", message: "Installer downloaded. Move the app to Applications, open it and prepare the models, then press Start." };
    await chrome.storage.session.set({ captureStatus: next });
    void chrome.runtime.sendMessage({ target: "worker", type: "capture-status", status: next }).catch(() => {});
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void readStatus().then(async (current) => {
    if (current.tabId === tabId) { await interruptStart(); await enqueue(stopCapture); }
  });
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "loading" && !change.url) return;
  void readStatus().then(async (current) => {
    if (current.tabId === tabId) { await interruptStart(); await enqueue(stopCapture); }
  });
});
