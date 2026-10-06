import type { CaptionRevision, PresentationEvent } from "../../packages/contracts";
import type { OutputSink } from "./contracts";
import { createLegacyPresentation, displayCaption } from "./presentation";

export function createCaptionOverlay(sessionId: string): OutputSink {
  const host = document.createElement("div");
  host.id = "interpreter-captions";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { pointer-events: none; }
    .cue {
      position: absolute; bottom: max(80px, 10vh); left: 50%; transform: translateX(-50%);
      box-sizing: border-box; width: min(80vw, 960px);
      padding: 4px 12px; border-radius: 4px; background: rgba(0,0,0,.55);
      color: white; font: 600 clamp(18px, 2.4vw, 32px)/1.4 system-ui, sans-serif;
      text-align: center; white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere;
      text-shadow: -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black, 1px 1px 1px black, 0 2px 4px black;
      pointer-events: none;
    }
    .cue:empty { display: none; }
    .sentence { transition: opacity 250ms ease-out; }
    .measure { position: absolute; visibility: hidden; left: 12px; right: 12px; }
    .notice {
      position: absolute; top: 12px; right: 12px; padding: 4px 8px;
      background: rgba(0,0,0,.75); color: white; font: 14px/1.4 system-ui, sans-serif;
    }
    .notice:empty { display: none; }
  `;
  const cue = document.createElement("div");
  cue.className = "cue";
  const measure = document.createElement("div");
  measure.className = "measure";
  const notice = document.createElement("div");
  notice.className = "notice";
  shadow.append(style, cue, notice);
  const entries: { caption: CaptionRevision; node: HTMLDivElement; offset: number; end: number; partIndex: number }[] = [];
  let dropped = 0;
  let disposed = false;
  const policy = createLegacyPresentation(sessionId, present);

  function attach() {
    if ((!entries.length && !notice.textContent) || disposed) return;
    const parent = document.fullscreenElement ?? document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
  }

  function clear() {
    entries.length = 0;
    dropped = 0;
    cue.replaceChildren();
    notice.textContent = "";
    host.remove();
  }

  function layout() {
    if (disposed) return;
    attach();
    const youtubePlayer = document.querySelector("ytd-watch-flexy #movie_player");
    const bottom = youtubePlayer && !document.fullscreenElement
      ? Math.max(80, innerHeight - youtubePlayer.getBoundingClientRect().bottom + 80)
      : Math.max(80, innerHeight * 0.1);
    cue.style.bottom = `${bottom}px`;
    cue.append(measure);
    const lineHeight = Number.parseFloat(getComputedStyle(cue).lineHeight);
    let available = Math.max(1, Math.min(4, Math.floor((innerHeight - bottom - 24) / lineHeight)));
    for (const [index, entry] of entries.entries()) {
      if (!available) { entry.node.remove(); report(entry, false); continue; }
      const characters = Array.from(displayCaption(entry.caption).translation.trim());
      let low = entry.offset + 1;
      let high = characters.length;
      const followingVisible = entries.slice(index + 1).filter((item) => item.node.isConnected).length;
      const lines = Math.max(1, Math.min(2, available - followingVisible));
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        measure.textContent = characters.slice(entry.offset, middle).join("");
        if (measure.clientHeight <= lineHeight * lines + 1) low = middle;
        else high = middle - 1;
      }
      const text = characters.slice(entry.offset, low).join("");
      if (entry.node.textContent !== text) entry.node.textContent = text;
      entry.end = low;
      if (!entry.node.isConnected) cue.insertBefore(entry.node, measure);
      available -= Math.max(1, Math.round(entry.node.clientHeight / lineHeight));
      report(entry, true);
    }
    measure.remove();
    // Bound hidden work separately from the four visible lines; report actual loss.
    let skipped = 0;
    const waiting = () => entries.filter((entry) => !entry.node.isConnected);
    while (waiting().length > 4 || waiting().reduce((ms, entry) => ms + entry.caption.source.audioRange.endMs - entry.caption.source.audioRange.startMs, 0) > 12000) {
      const entry = entries.find((entry) => !entry.node.isConnected);
      if (entry) policy.retire(entry.caption.source.utteranceId);
      skipped++;
    }
    if (skipped) {
      dropped += skipped;
      notice.textContent = `자막 표시 과부하: 대기 문장 ${dropped}개 생략 (4개/12초 제한)`;
      console.warn(`Interpreter skipped ${skipped} waiting captions (total ${dropped}; 4 captions/12 seconds of audio).`);
    }
    if (!entries.length && !notice.textContent) host.remove();
  }

  function report(entry: typeof entries[number], visible: boolean) {
    const caption = entry.caption;
    if (caption.translation.state !== "paired") return;
    policy.progress({ identity: caption.source.identity, utteranceId: caption.source.utteranceId,
      sourceRevision: caption.source.sourceRevision, translationRevision: caption.translation.revision.translationRevision,
      partIndex: entry.partIndex, complete: entry.end >= Array.from(caption.translation.revision.text.trim()).length,
      visible, characterCount: entry.node.textContent?.length ?? 0 });
  }

  function present(event: PresentationEvent) {
    if (event.type === "clear") { clear(); return; }
    if (event.type === "fade" || event.type === "remove") {
      const index = entries.findIndex((entry) => entry.caption.source.utteranceId === event.utteranceId);
      const entry = entries[index];
      if (!entry) return;
      if (event.type === "fade") {
        entry.node.style.transitionDuration = `${event.durationMs}ms`;
        entry.node.style.opacity = "0";
      } else {
        entries.splice(index, 1);
        entry.node.remove();
        layout();
      }
      return;
    }
    const caption = event.caption;
    let entry = entries.find((item) => item.caption.source.utteranceId === caption.source.utteranceId);
    if (entry) {
      if (event.type === "replay") {
        entry.offset = event.partIndex === 0 ? 0 : entry.end;
        entry.end = entry.offset;
        entry.partIndex = event.partIndex;
      } else if (entry.offset && displayCaption(entry.caption).translation !== displayCaption(caption).translation) {
        const previous = Array.from(displayCaption(entry.caption).translation.trim());
        const next = Array.from(displayCaption(caption).translation.trim());
        let prefix = 0;
        while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
        let suffix = 0;
        while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
        // Preserve the measured unread suffix across edits to the read prefix.
        if (entry.offset >= previous.length - suffix) entry.offset += next.length - previous.length;
        else if (entry.offset > prefix) entry.offset = prefix;
      }
      entry.caption = caption;
    } else {
      const node = document.createElement("div");
      node.className = "sentence";
      node.dataset.utteranceId = caption.source.utteranceId;
      entry = { caption, node, offset: 0, end: 0, partIndex: 0 };
      entries.push(entry);
    }
    layout();
  }

  document.addEventListener("fullscreenchange", layout);
  window.addEventListener("resize", layout);
  const observer = new MutationObserver((changes) => {
    if (disposed) return;
    if (changes.some((change) => change.type === "attributes")) layout();
    else attach();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["theater"] });

  const output: OutputSink = {
    caption(caption) {
      if (disposed || !caption.translation.trim()) return;
      policy.caption(caption);
    },
    status(message) { notice.textContent = message; attach(); },
    clear() { policy.clear(); },
    dispose() {
      disposed = true;
      policy.dispose();
      observer.disconnect();
      document.removeEventListener("fullscreenchange", layout);
      window.removeEventListener("resize", layout);
    },
  };
  return output;
}
