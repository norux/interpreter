import { createChromeComposition } from "./composition";
import { createRemoteVideoOutput, tabOverlayChannelName } from "./overlay-channel";
import { createChromeTabInput } from "./tab-input";

const status = document.querySelector("#connection") as HTMLElement;
const overlayStatus = document.querySelector("#overlay-status") as HTMLElement;
const language = document.querySelector("#language") as HTMLSelectElement;
const captureButton = document.querySelector("#capture") as HTMLButtonElement;
const tabId = Number(new URLSearchParams(location.search).get("tab"));
if (!Number.isSafeInteger(tabId) || tabId <= 0) {
  status.textContent = "Open this window using Interpreter on the tab you want to interpret.";
  captureButton.disabled = true; language.disabled = true;
} else {
  let generation = 0;
  let disposed = false;
  let invalidated = false;
  let pageOutput: ReturnType<typeof createRemoteVideoOutput> | undefined;
  const capture = createChromeTabInput(tabId, chrome.runtime.getURL("pcm-worklet.js"),
    { maxChunkBytes: 8192, maxAudioQueueMs: 1000 }, reason => {
      invalidated = true; captureButton.disabled = true; language.disabled = true;
      void app.select(null, language.value as "ja" | "en");
      status.textContent = `${reason}. Reopen Interpreter using the original tab's extension action.`;
    });
  const app = createChromeComposition(document.querySelector("#app") as HTMLElement, capture.input, () => {
    generation++; const stopped = capture.stop();
    captureButton.disabled = invalidated; language.disabled = invalidated;
    if (!invalidated) status.textContent = "Stopped. Capture the original tab again before preparing.";
    return stopped;
  }, {
    activate(target, identity) { pageOutput?.activate(target, identity); },
    compare(caption) { pageOutput?.compare(caption); },
    clear(identity) { pageOutput?.clear(identity); },
  }, "tab-mix");
  async function beginCapture() {
    captureButton.disabled = true;
    const clearing = app.select(null, language.value as "ja" | "en");
    let current = generation;
    await clearing;
    if (disposed || invalidated || current !== generation) return;
    const selecting = app.select(capture.target, language.value as "ja" | "en");
    current = generation;
    await selecting;
    if (disposed || invalidated || current !== generation) return;
    current = ++generation; captureButton.disabled = true; language.disabled = true;
    status.textContent = "Starting audio capture for the original tab…";
    try {
      await capture.capture();
      if (disposed || invalidated || current !== generation) return;
      language.disabled = false;
      status.textContent = `Capturing all audio from original tab ${tabId}. Times are capture elapsed, not video time. Prepare, then Start.`;
      // A failed competing capture must not replace a running host's overlay.
      if (!pageOutput) {
        void chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["tab-content.js"] }).then(() => {
          if (disposed || invalidated || current !== generation) return;
          pageOutput = createRemoteVideoOutput(chrome.tabs.connect(tabId, { name: tabOverlayChannelName, frameId: 0 }), message => {
            overlayStatus.textContent = `Page captions unavailable: ${message}. Comparison remains in this window.`;
          });
          overlayStatus.textContent = "Page captions available without selecting a video.";
        }).catch(error => {
          if (!disposed && current === generation) overlayStatus.textContent = `Page captions unavailable: ${error.message}. Tab capture and comparison do not require page injection.`;
        });
      }
    } catch (error) {
      if (disposed || current !== generation) return;
      await app.select(null, language.value as "ja" | "en");
      status.textContent = `Tab capture unavailable: ${String(error)}. Try its extension action again. No other input was used.`;
    }
  }
  captureButton.onclick = () => { void beginCapture(); };
  language.onchange = () => { void beginCapture(); };
  // Start authorized capture before optional DOM injection or model preparation.
  void beginCapture();
  window.addEventListener("pagehide", () => {
    disposed = true; generation++; pageOutput?.dispose(); void app.dispose(); void capture.dispose();
  });
}
