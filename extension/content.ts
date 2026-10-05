import type { CaptionCommand, OutputSink } from "./captions/contracts";
import { createCaptionOverlay } from "./captions/overlay";

// executeScript can run again on a tab after Stop/Start.
const scope = globalThis as typeof globalThis & { interpreterCaptionsInstalled?: boolean };
if (!scope.interpreterCaptionsInstalled) {
  scope.interpreterCaptionsInstalled = true;
  let sessionId: string | undefined;
  let sink: OutputSink | undefined;
  chrome.runtime.onMessage.addListener((message: CaptionCommand, sender) => {
    if (sender.id !== chrome.runtime.id || message.target !== "captions") return;
    if (message.type === "start") {
      sink?.dispose();
      sessionId = message.sessionId;
      sink = createCaptionOverlay();
    } else if (message.type === "caption" && message.caption.sessionId === sessionId) {
      sink?.caption(message.caption);
    } else if (message.type === "clear" && message.sessionId === sessionId) {
      sink?.dispose();
      sink = undefined;
      sessionId = undefined;
    }
  });
}
