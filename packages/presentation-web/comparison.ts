import type { CaptionRevision, DisplayProgress, OutputSink, PresentationEvent, SessionIdentity } from "../contracts";
import { sameIdentity } from "../core/identity";
import { captionHistoryLimit } from "../core/presentation-policy";

export function createComparisonView(container: HTMLElement) {
  const document = container.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Comparison view requires a live document");
  const host = document.createElement("section");
  host.setAttribute("aria-label", "Interpreter captions");
  const style = document.createElement("style");
  style.textContent = `
    .interpreter-live { position:relative; padding:8px; min-height:3.2em; font:18px/1.5 system-ui;
      white-space:pre-wrap; overflow-wrap:anywhere; transition:opacity 250ms ease-out; }
    .interpreter-measure { position:absolute; visibility:hidden; left:8px; right:8px; }
    .interpreter-comparison { width:100%; table-layout:fixed; border-collapse:collapse; }
    .interpreter-comparison th, .interpreter-comparison td { padding:8px; vertical-align:top;
      text-align:start; white-space:pre-wrap; overflow-wrap:anywhere; }
    .interpreter-comparison th:nth-child(2) { width:6em; }
  `;
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const cue = document.createElement("div"); cue.className = "interpreter-live"; cue.setAttribute("aria-live", "polite");
  const text = document.createElement("span");
  const measure = document.createElement("span"); measure.className = "interpreter-measure"; measure.setAttribute("aria-hidden", "true");
  cue.append(text, measure);
  const table = document.createElement("table"); table.className = "interpreter-comparison";
  const head = document.createElement("thead"); const headings = document.createElement("tr");
  for (const label of ["Original", "Video time", "Korean"]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; headings.append(cell); }
  head.append(headings); const body = document.createElement("tbody"); table.append(head, body);
  host.append(style, status, cue, table); container.append(host);
  const rows = new Map<string, HTMLTableRowElement>();
  const listeners = new Set<(progress: DisplayProgress) => void>();
  const entries: { caption: CaptionRevision; offset: number; end: number; partIndex: number; fading: boolean }[] = [];
  let identity: SessionIdentity | undefined;
  let disposed = false;

  function key(caption: CaptionRevision) {
    const source = caption.source;
    return JSON.stringify([source.identity.sessionId, source.identity.targetId, source.identity.epoch, source.utteranceId]);
  }
  function layout() {
    if (disposed) return;
    const front = entries[0];
    if (!front) { text.textContent = ""; cue.style.opacity = "1"; return; }
    cue.style.opacity = front.fading ? "0" : "1";
    const caption = front.caption;
    const characters = Array.from((caption.translation.state === "paired" ? caption.translation.revision.text : caption.source.text).trim());
    let low = Math.min(front.offset + 1, characters.length); let high = characters.length;
    const lineHeight = Number.parseFloat(window?.getComputedStyle(cue).lineHeight ?? "27");
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      measure.textContent = characters.slice(front.offset, middle).join("");
      if (measure.getBoundingClientRect().height <= lineHeight * 2 + 1) low = middle;
      else high = middle - 1;
    }
    front.end = low; text.textContent = characters.slice(front.offset, low).join(""); measure.textContent = "";
    for (const entry of entries) {
      const translation = entry.caption.translation;
      const displayed = translation.state === "paired" ? translation.revision.text : entry.caption.source.text;
      const progress: DisplayProgress = { identity: entry.caption.source.identity, utteranceId: entry.caption.source.utteranceId,
        sourceRevision: entry.caption.source.sourceRevision, translationRevision: translation.state === "paired" ? translation.revision.translationRevision : undefined,
        partIndex: entry.partIndex, complete: entry.end >= Array.from(displayed.trim()).length,
        visible: entry === front && cue.getBoundingClientRect().width > 0, characterCount: entry === front ? Array.from(text.textContent).length : 0 };
      for (const listener of listeners) listener(progress);
    }
  }
  const observer = new window.ResizeObserver(layout); observer.observe(cue);
  const sink: OutputSink = {
    present(event: PresentationEvent) {
      const current = "caption" in event ? event.caption.source.identity : event.identity;
      if (disposed || !identity || !sameIdentity(identity, current)) return;
      if (event.type === "clear") { entries.length = 0; layout(); return; }
      if (event.type === "fade" || event.type === "remove") {
        const index = entries.findIndex(entry => entry.caption.source.utteranceId === event.utteranceId);
        if (index < 0) return;
        if (event.type === "fade") { entries[index].fading = true; cue.style.transitionDuration = `${event.durationMs}ms`; }
        else entries.splice(index, 1);
        layout(); return;
      }
      let entry = entries.find(entry => entry.caption.source.utteranceId === event.caption.source.utteranceId);
      if (!entry) {
        entry = { caption: event.caption, offset: 0, end: 0, partIndex: 0, fading: false }; entries.push(entry);
      }
      // Source and translated text have independent layout offsets.
      if (entry.caption.translation.state !== event.caption.translation.state) {
        entry.offset = 0; entry.end = 0; entry.partIndex = 0;
      }
      if (event.type === "replay") { entry.offset = event.partIndex === 0 ? 0 : entry.end; entry.partIndex = event.partIndex; }
      entry.caption = event.caption;
      layout();
    },
    status(value) { if (!disposed) { status.textContent = `${value.state}: ${value.reason ?? value.message}`; status.dataset.state = value.state;
      status.dataset.pendingAudioMs = value.queue ? `${value.queue.pendingAudioMs}` : "";
      status.dataset.droppedAudioMs = value.queue ? `${value.queue.droppedAudioMs}` : ""; } },
    onDisplayProgress(receive) { listeners.add(receive); return () => { listeners.delete(receive); }; },
    dispose() { if (disposed) return; disposed = true; observer.disconnect(); listeners.clear(); rows.clear(); entries.length = 0; host.remove(); },
  };
  return {
    ...sink,
    activate(selected: SessionIdentity) { entries.length = 0; identity = { ...selected }; layout(); },
    compare(caption: CaptionRevision) {
      if (disposed || !identity || !sameIdentity(identity, caption.source.identity)) return;
      const id = key(caption); let row = rows.get(id);
      if (!row) {
        row = document.createElement("tr"); for (let i = 0; i < 3; i++) row.append(document.createElement("td"));
        rows.set(id, row); body.append(row);
      }
      row.dataset.utteranceId = caption.source.utteranceId; row.dataset.epoch = `${caption.source.identity.epoch}`;
      row.dataset.sourceRevision = `${caption.source.sourceRevision}`; row.dataset.sourceFinal = `${caption.source.final}`;
      row.dataset.translationState = caption.translation.state;
      row.cells[0].textContent = caption.source.text;
      // Absence of an anchor stays explicit; session elapsed time is not video time.
      row.cells[1].textContent = caption.videoRange ? `${(caption.videoRange.startMs / 1000).toFixed(1)}–${(caption.videoRange.endMs / 1000).toFixed(1)} s` : "Unavailable";
      row.cells[2].textContent = caption.translation.state === "paired" ? caption.translation.revision.text : "Translation pending";
      row.dataset.translationRevision = caption.translation.state === "paired" ? `${caption.translation.revision.translationRevision}` : "";
      row.dataset.translationFinal = caption.translation.state === "paired" ? `${caption.translation.revision.final}` : "false";
      if (rows.size > captionHistoryLimit) { const first = rows.entries().next().value; if (first) { first[1].remove(); rows.delete(first[0]); } }
    },
  };
}
