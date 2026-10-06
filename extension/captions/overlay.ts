import type { Caption, OutputSink } from "./contracts";

export function createCaptionOverlay(): OutputSink {
  const host = document.createElement("div");
  host.id = "interpreter-captions";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { pointer-events: none; }
    .cue {
      position: absolute; bottom: max(80px, 10vh); left: 50%; transform: translateX(-50%);
      box-sizing: border-box; width: max-content; max-width: min(80vw, 960px);
      padding: 4px 12px; border-radius: 4px; background: rgba(0,0,0,.55);
      color: white; font: 600 clamp(18px, 2.4vw, 32px)/1.4 system-ui, sans-serif;
      text-align: center; text-wrap: balance; white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere;
      text-shadow: -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black, 1px 1px 1px black, 0 2px 4px black;
      pointer-events: none;
    }
    .cue:empty { display: none; }
  `;
  const cue = document.createElement("div");
  cue.className = "cue";
  shadow.append(style, cue);
  let current: Caption | undefined;
  const pending: Caption[] = [];
  let parts: string[] = [];
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function attach() {
    if (!current || disposed) return;
    const parent = document.fullscreenElement ?? document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
  }

  function clear() {
    clearTimeout(timer);
    timer = undefined;
    current = undefined;
    pending.length = 0;
    parts = [];
    index = 0;
    cue.textContent = "";
    host.remove();
  }

  function show() {
    clearTimeout(timer);
    cue.textContent = parts[index] ?? "";
    const duration = Math.min(6000, Math.max(2500, (parts[index]?.length ?? 0) * 90));
    timer = setTimeout(() => {
      if (index + 1 < parts.length) { index++; show(); }
      else if (pending.length) { current = pending.shift(); layout(); }
      else clear();
    }, duration);
  }

  function layout() {
    if (!current || disposed) return;
    attach();
    const youtubePlayer = document.querySelector("ytd-watch-flexy #movie_player");
    cue.style.bottom = youtubePlayer && !document.fullscreenElement
      ? `${Math.max(80, innerHeight - youtubePlayer.getBoundingClientRect().bottom + 80)}px`
      : "";
    // Measure the actual wrapped font at this viewport; never hide a third line.
    const characters = Array.from(current.translation.trim());
    parts = [];
    while (characters.length) {
      let low = 1;
      let high = characters.length;
      const lineHeight = Number.parseFloat(getComputedStyle(cue).lineHeight);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        cue.textContent = characters.slice(0, middle).join("");
        if (cue.clientHeight <= lineHeight * 2 + 9) low = middle;
        else high = middle - 1;
      }
      let end = low;
      // Prefer a nearby word boundary without dropping any characters.
      for (let boundary = low; boundary > low * 0.7; boundary--) {
        if (/\s|[.!?。！？]/u.test(characters[boundary - 1])) { end = boundary; break; }
      }
      parts.push(characters.splice(0, end).join(""));
    }
    index = 0;
    show();
  }

  document.addEventListener("fullscreenchange", layout);
  window.addEventListener("resize", layout);
  const observer = new MutationObserver((changes) => {
    if (!current || disposed) return;
    if (changes.some((change) => change.type === "attributes")) layout();
    else attach();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["theater"] });

  return {
    caption(caption) {
      if (disposed) return;
      if (current?.utteranceId === caption.utteranceId && current.revision >= caption.revision) return;
      const waiting = pending.findIndex((item) => item.utteranceId === caption.utteranceId);
      if (waiting >= 0) {
        if (pending[waiting].revision < caption.revision) pending[waiting] = caption;
        return;
      }
      // Finish unread final parts before a later utterance can replace them.
      if (current?.final && current.utteranceId !== caption.utteranceId && (parts.length > 1 || pending.length)) {
        pending.push(caption);
        let dropped = 0;
        while (pending.length > 2 || pending.reduce((ms, item) => ms + item.audioEndMs - item.audioStartMs, 0) > 8000) {
          pending.shift();
          dropped++;
        }
        if (dropped) console.warn(`Interpreter skipped ${dropped} waiting captions to limit subtitle delay.`);
        return;
      }
      current = caption;
      layout();
    },
    status() {},
    clear,
    dispose() {
      disposed = true;
      clear();
      observer.disconnect();
      document.removeEventListener("fullscreenchange", layout);
      window.removeEventListener("resize", layout);
    },
  };
}
