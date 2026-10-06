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
      box-sizing: border-box; width: min(80vw, 960px);
      padding: 4px 12px; border-radius: 4px; background: rgba(0,0,0,.55);
      color: white; font: 600 clamp(18px, 2.4vw, 32px)/1.4 system-ui, sans-serif;
      text-align: center; white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere;
      text-shadow: -1px -1px 1px black, 1px -1px 1px black, -1px 1px 1px black, 1px 1px 1px black, 0 2px 4px black;
      pointer-events: none;
    }
    .cue:empty { display: none; }
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
  const entries: { caption: Caption; node: HTMLDivElement; offset: number; end: number; until: number }[] = [];
  // Audio position also rejects late corrections after a sentence has left the display.
  let retiredThrough = -Infinity;
  const retiredIds: string[] = [];
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function attach() {
    if ((!entries.length && !notice.textContent) || disposed) return;
    const parent = document.fullscreenElement ?? document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
  }

  function clear() {
    clearTimeout(timer);
    timer = undefined;
    entries.length = 0;
    retiredThrough = -Infinity;
    retiredIds.length = 0;
    dropped = 0;
    cue.replaceChildren();
    notice.textContent = "";
    host.remove();
  }

  function retire(index: number) {
    const [entry] = entries.splice(index, 1);
    retiredThrough = Math.max(retiredThrough, entry.caption.audioStartMs);
    retiredIds.push(entry.caption.utteranceId);
    if (retiredIds.length > 128) retiredIds.shift();
    entry.node.remove();
  }

  function layout() {
    clearTimeout(timer);
    if (disposed) return;
    attach();
    const youtubePlayer = document.querySelector("ytd-watch-flexy #movie_player");
    const bottom = youtubePlayer && !document.fullscreenElement
      ? Math.max(80, innerHeight - youtubePlayer.getBoundingClientRect().bottom + 80)
      : Math.max(80, innerHeight * 0.1);
    cue.style.bottom = `${bottom}px`;
    const now = performance.now();
    // Advance only the oldest visible sentence, after its own reading time.
    while (entries[0]?.until && entries[0].until <= now) {
      const entry = entries[0];
      // Keep the latest provisional ending available for its delayed correction.
      if (!entry.caption.final && entries.length === 1 && entry.end >= Array.from(entry.caption.translation.trim()).length) break;
      entry.offset = entry.end;
      entry.until = 0;
      if (entry.offset >= Array.from(entry.caption.translation.trim()).length) retire(0);
      else break;
    }
    cue.append(measure);
    const lineHeight = Number.parseFloat(getComputedStyle(cue).lineHeight);
    let available = Math.max(1, Math.min(4, Math.floor((innerHeight - bottom - 24) / lineHeight)));
    for (const [index, entry] of entries.entries()) {
      if (!available) { entry.node.remove(); entry.until = 0; continue; }
      const characters = Array.from(entry.caption.translation.trim());
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
      const extended = low > entry.end;
      if (entry.node.textContent !== text) entry.node.textContent = text;
      entry.end = low;
      if (!entry.node.isConnected) cue.insertBefore(entry.node, measure);
      available -= Math.max(1, Math.round(entry.node.clientHeight / lineHeight));
      if (!entry.until || extended) entry.until = Math.max(entry.until, now + Math.min(6000, Math.max(2500, text.length * 90)));
    }
    measure.remove();
    // Bound hidden work separately from the four visible lines; report actual loss.
    let skipped = 0;
    const waiting = () => entries.filter((entry) => !entry.node.isConnected);
    while (waiting().length > 4 || waiting().reduce((ms, entry) => ms + entry.caption.audioEndMs - entry.caption.audioStartMs, 0) > 12000) {
      retire(entries.findIndex((entry) => !entry.node.isConnected));
      skipped++;
    }
    if (skipped) {
      dropped += skipped;
      notice.textContent = `자막 표시 과부하: 대기 문장 ${dropped}개 생략 (4개/12초 제한)`;
      console.warn(`Interpreter skipped ${skipped} waiting captions (total ${dropped}; 4 captions/12 seconds of audio).`);
    }
    if (entries[0]?.until > now) timer = setTimeout(layout, Math.max(1, entries[0].until - performance.now()));
    else if (!entries.length && !notice.textContent) host.remove();
  }

  document.addEventListener("fullscreenchange", layout);
  window.addEventListener("resize", layout);
  const observer = new MutationObserver((changes) => {
    if (disposed) return;
    if (changes.some((change) => change.type === "attributes")) layout();
    else attach();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["theater"] });

  return {
    caption(caption) {
      if (disposed || !caption.translation.trim()) return;
      const entry = entries.find((item) => item.caption.utteranceId === caption.utteranceId);
      if (entry) {
        if (entry.caption.revision >= caption.revision || (entry.caption.final && !caption.final)) return;
        const changed = entry.caption.translation !== caption.translation || entry.caption.final !== caption.final;
        if (entry.offset && entry.caption.translation !== caption.translation) {
          const previous = Array.from(entry.caption.translation.trim());
          const next = Array.from(caption.translation.trim());
          let prefix = 0;
          while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
          let suffix = 0;
          while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
          // Anchor an unread suffix across edits to the read prefix; show a changed
          // current part from the edit boundary instead of skipping its new words.
          if (entry.offset >= previous.length - suffix) entry.offset += next.length - previous.length;
          else if (entry.offset > prefix) entry.offset = prefix;
        }
        entry.caption = caption;
        // Only this sentence gets a new reading deadline; other sentences keep theirs.
        if (changed) entry.until = 0;
      } else {
        // Direct translation can assign several distinct cues the same audio timestamp.
        if (caption.audioStartMs < retiredThrough || retiredIds.includes(caption.utteranceId)) return;
        const node = document.createElement("div");
        node.className = "sentence";
        node.dataset.utteranceId = caption.utteranceId;
        entries.push({ caption, node, offset: 0, end: 0, until: 0 });
      }
      layout();
    },
    status(message) { notice.textContent = message; attach(); },
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
