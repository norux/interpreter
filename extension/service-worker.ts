import type { CaptureCommand, CaptureStatus } from "./capture/contracts";

const idle: CaptureStatus = { state: "idle", message: "Ready to capture tab audio." };
let operations = Promise.resolve();

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length > 0;
}

async function readStatus(): Promise<CaptureStatus> {
  if (await hasOffscreen()) return chrome.runtime.sendMessage({ target: "offscreen", type: "status" });
  const saved = await chrome.storage.session.get("captureStatus") as { captureStatus?: CaptureStatus };
  return saved.captureStatus ?? idle;
}

async function stopCapture(): Promise<CaptureStatus> {
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
    await chrome.offscreen.closeDocument();
  }
  await chrome.storage.session.set({ captureStatus: idle });
  return idle;
}

async function startCapture(): Promise<CaptureStatus> {
  await stopCapture();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    const next: CaptureStatus = { state: "error", message: "Open an ordinary HTTP/HTTPS page with audio. Chrome internal pages cannot be captured." };
    await chrome.storage.session.set({ captureStatus: next });
    return next;
  }
  await chrome.storage.session.set({ captureStatus: { state: "starting", tabId: tab.id, message: "Starting tab capture…" } });
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capture user-selected tab audio and preserve its original playback.",
    });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const next: CaptureStatus = await chrome.runtime.sendMessage({ target: "offscreen", type: "start", streamId, tabId: tab.id });
    if (next.state === "error") await chrome.offscreen.closeDocument();
    await chrome.storage.session.set({ captureStatus: next });
    return next;
  } catch (error) {
    await stopCapture();
    const next: CaptureStatus = { state: "error", message: error instanceof Error ? error.message : "Tab capture failed." };
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
  if (message.type === "capture-status") {
    if (sender.url === chrome.runtime.getURL("offscreen.html")) {
      void chrome.storage.session.set({ captureStatus: message.status });
    }
    return;
  }
  // Only the extension popup can initiate recording; page/content messages cannot.
  if (sender.url !== chrome.runtime.getURL("popup.html")) return;
  const task = message.type === "status" ? readStatus() : enqueue(message.type === "start" ? startCapture : stopCapture);
  void task.then(respond, (error) => respond({ state: "error", message: String(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => (await readStatus()).tabId === tabId ? stopCapture() : readStatus());
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "loading" && !change.url) return;
  void enqueue(async () => (await readStatus()).tabId === tabId ? stopCapture() : readStatus());
});
