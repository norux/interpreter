import type { CaptionCommand } from "./captions/contracts";
import { createCaptionOutput } from "./captions/output";
import { createCaptionOverlay } from "./captions/overlay";

// executeScript can run again on a tab after Stop/Start.
const scope = globalThis as typeof globalThis & { interpreterCaptionsInstalled?: boolean };
if (!scope.interpreterCaptionsInstalled) {
  scope.interpreterCaptionsInstalled = true;
  let sessionId: string | undefined;
  let output: ReturnType<typeof createCaptionOutput> | undefined;
  chrome.runtime.onMessage.addListener((message: CaptionCommand, sender) => {
    if (sender.id !== chrome.runtime.id || message.target !== "captions") return;
    if (message.type === "start") {
      output?.dispose();
      sessionId = message.sessionId;
      output = createCaptionOutput(sessionId, [createCaptionOverlay()]);
    } else if (message.type === "caption" && message.caption.sessionId === sessionId) {
      output?.event({ type: "caption", caption: message.caption });
    } else if (message.type === "clear" && message.sessionId === sessionId) {
      output?.dispose();
      output = undefined;
      sessionId = undefined;
    }
  });
}
