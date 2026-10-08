import { createMediaCatalog } from "../../packages/media-web/catalog";
import { createVideoInput } from "../../packages/media-web/audio-input";
import { channelName, serveVideoInput } from "./channel";
import { overlayChannelName, serveVideoOutput } from "./overlay-channel";

// executeScript can be invoked again after another action click. Keep exactly
// one isolated-world media owner per document; page scripts cannot access it.
const owner = globalThis as typeof globalThis & { interpreterMediaHost?: boolean };
if (!owner.interpreterMediaHost) {
  owner.interpreterMediaHost = true;
  const catalog = createMediaCatalog(document, "0");
  const input = createVideoInput(catalog, chrome.runtime.getURL("pcm-worklet.js"), { maxChunkBytes: 8192, maxAudioQueueMs: 1000 });
  let connection: ReturnType<typeof serveVideoInput> | undefined;
  let display: ReturnType<typeof serveVideoOutput> | undefined;
  chrome.runtime.onConnect.addListener(port => {
    if (![channelName, overlayChannelName].includes(port.name) || port.sender?.id !== chrome.runtime.id
      || !port.sender.url?.startsWith(`${chrome.runtime.getURL("host.html")}?`)) { port.disconnect(); return; }
    if (port.name === overlayChannelName) { display?.dispose(); display = serveVideoOutput(port, catalog); return; }
    connection?.dispose();
    connection = serveVideoInput(port, input, catalog, (start, cancel) => {
      const panel = document.createElement("div");
      const shadow = panel.attachShadow({ mode: "open" });
      panel.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647";
      const box = document.createElement("section");
      box.style.cssText = "background:white;color:black;border:2px solid black;padding:16px;font:16px sans-serif";
      box.setAttribute("aria-label", "Selected video interpretation");
      const label = document.createElement("p"); label.textContent = "Play the confirmed video, then allow its audio for this session.";
      const allow = document.createElement("button"); allow.type = "button"; allow.textContent = "Allow selected video audio";
      allow.onclick = () => { allow.disabled = true; start(); };
      const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "Cancel interpretation"; stop.onclick = cancel;
      box.append(label, allow, stop); shadow.append(box); document.documentElement.append(panel);
      return () => panel.remove();
    });
  });
  window.addEventListener("pagehide", () => { display?.dispose(); connection?.dispose(); catalog.dispose(); });
}
