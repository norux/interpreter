import { serveVideoOutput, tabOverlayChannelName } from "./overlay-channel";

// Optional presentation only. No media catalog, input graph or page PCM owner.
const owner = globalThis as typeof globalThis & { interpreterTabOverlayHost?: boolean };
if (!owner.interpreterTabOverlayHost) {
  owner.interpreterTabOverlayHost = true;
  let display: ReturnType<typeof serveVideoOutput> | undefined;
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== tabOverlayChannelName || port.sender?.id !== chrome.runtime.id
      || (port.sender.url !== chrome.runtime.getURL("service-worker.js") && (port.sender.url || port.sender.tab))) { port.disconnect(); return; }
    display?.dispose(); display = serveVideoOutput(port, undefined, document);
  });
  window.addEventListener("pagehide", () => display?.dispose());
}
