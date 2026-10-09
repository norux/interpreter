import type { MediaCandidate, MediaTarget } from "../../packages/contracts";
import { channelName, createRemoteVideoInput } from "./channel";
import { createChromeComposition } from "./composition";
import { createRemoteVideoOutput, overlayChannelName } from "./overlay-channel";

const status = document.querySelector("#connection") as HTMLElement;
const select = document.querySelector("#video") as HTMLSelectElement;
const language = document.querySelector("#language") as HTMLSelectElement;
const confirm = document.querySelector("#confirm") as HTMLButtonElement;
const container = document.querySelector("#app") as HTMLElement;
const tabId = Number(new URLSearchParams(location.search).get("tab"));
if (!Number.isSafeInteger(tabId) || tabId <= 0) {
  status.textContent = "Open this window using Jamak on the video page."; confirm.disabled = true;
  (status.parentElement as HTMLDetailsElement).open = true;
} else {
  const remote = createRemoteVideoInput(chrome.tabs.connect(tabId, { name: channelName, frameId: 0 }));
  const pageOutput = createRemoteVideoOutput(chrome.tabs.connect(tabId, { name: overlayChannelName, frameId: 0 }), message => {
    status.textContent = message; select.disabled = true; language.disabled = true; confirm.disabled = true; selected = null; void app.select(null, language.value as "ja" | "en");
    (status.parentElement as HTMLDetailsElement).open = true;
  });
  const app = createChromeComposition(container, remote.input, remote.stop, pageOutput);
  let candidates: readonly MediaCandidate[] = [];
  let selected: MediaTarget | null = null;
  let revision = 0;
  let disposed = false;
  async function refresh() {
    const current = ++revision;
    try {
      const next = await remote.discover();
      if (disposed || current !== revision) return;
      candidates = next;
      if (selected && !next.some(item => item.target.id === selected?.id && item.target.documentId === selected?.documentId)) {
        selected = null; await app.select(null, language.value as "ja" | "en");
        status.textContent = "Selected video changed. Confirm again; no replacement was selected.";
      }
      const previous = select.value;
      select.replaceChildren(new Option("Choose a video", ""));
      for (const item of next) select.add(new Option(`${item.label} · ${Math.round(item.width)}×${Math.round(item.height)} · ${item.playing ? "playing" : "paused"}`, item.target.id));
      select.value = next.some(item => item.target.id === previous) ? previous : "";
      confirm.disabled = select.disabled || !select.value;
    } catch (error) {
      status.textContent = `Page connection unavailable: ${String(error)}. Stop and reopen Jamak on the video page.`;
      (status.parentElement as HTMLDetailsElement).open = true;
      await app.select(null, "ja");
    }
  }
  select.onchange = () => { confirm.disabled = select.disabled || !select.value; };
  language.onchange = () => { void app.select(selected, language.value as "ja" | "en"); };
  confirm.onclick = () => {
    selected = candidates.find(item => item.target.id === select.value)?.target ?? null;
    void app.select(selected, language.value as "ja" | "en");
    status.textContent = selected ? "Video confirmed. Prepare, Start, then allow audio on the video page." : "Choose and confirm one video.";
  };
  const unsubscribe = remote.subscribe(() => { void refresh(); });
  window.addEventListener("pagehide", () => { disposed = true; revision++; unsubscribe(); pageOutput.dispose(); remote.dispose(); void app.dispose(); });
  status.textContent = "Choose and confirm one video. Page URLs and transcripts are not stored.";
  void refresh();
}
