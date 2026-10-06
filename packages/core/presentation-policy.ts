import type { CaptionRevision, DisplayProgress, InterpretationEvent, PresentationEvent, SessionIdentity } from "../contracts";
import { sameIdentity } from "./identity";
import { createRevisionStore } from "./revision-store";

export const captionHistoryLimit = 300;

interface PresentationClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

function finalPair(caption: CaptionRevision): boolean {
  return caption.source.final && caption.translation.state === "paired" && caption.translation.revision.final;
}

function translationText(caption: CaptionRevision): string {
  return caption.translation.state === "paired" ? caption.translation.revision.text : "";
}

export function createPresentationPolicy(initial: SessionIdentity, clock: PresentationClock, present: (event: PresentationEvent) => void) {
  type Entry = {
    caption: CaptionRevision;
    pending?: CaptionRevision;
    updatedAt: number;
    partIndex: number;
    progress?: DisplayProgress;
    until?: number;
    fading: boolean;
    retired: boolean;
  };
  let identity = initial;
  let store = createRevisionStore(identity, captionHistoryLimit);
  const entries = new Map<string, Entry>();
  let cancelTimer: (() => void) | undefined;
  let disposed = false;

  function visibleFront(): Entry | undefined {
    return [...entries.values()].find((entry) => !entry.retired && entry.progress?.visible);
  }

  function canExpire(entry: Entry): boolean {
    return entry.fading || !entry.progress?.complete || finalPair(entry.caption)
      || [...entries.values()].some((other) => other !== entry && !other.retired);
  }

  function schedule(): void {
    cancelTimer?.();
    cancelTimer = undefined;
    if (disposed) return;
    const deadlines = [...entries.values()].filter((entry) => entry.pending && !entry.retired && !entry.fading)
      .map((entry) => entry.updatedAt + 1000);
    const front = visibleFront();
    if (front?.until !== undefined && canExpire(front)) deadlines.push(front.until);
    if (deadlines.length) cancelTimer = clock.schedule(tick, Math.max(1, Math.min(...deadlines) - clock.now()));
  }

  function retire(entry: Entry): void {
    entry.retired = true;
    entry.pending = undefined;
    entry.until = undefined;
    present({ type: "remove", identity, utteranceId: entry.caption.source.utteranceId });
  }

  function paint(entry: Entry, caption: CaptionRevision, first: boolean): void {
    const replay = finalPair(caption) && (!finalPair(entry.caption)
      || translationText(entry.caption) !== translationText(caption));
    const changed = translationText(entry.caption) !== translationText(caption) || replay;
    entry.caption = caption;
    entry.pending = undefined;
    entry.updatedAt = clock.now();
    if (changed) { entry.progress = undefined; entry.until = undefined; }
    if (replay) entry.partIndex = 0;
    present(replay ? { type: "replay", caption, partIndex: 0 } : { type: first ? "insert" : "update", caption });
  }

  function tick(): void {
    cancelTimer = undefined;
    if (disposed) return;
    const now = clock.now();
    for (const entry of entries.values()) {
      if (entry.pending && !entry.retired && !entry.fading && entry.updatedAt + 1000 <= now) paint(entry, entry.pending, false);
    }
    // Reading advances in insertion order, including coexisting sentences.
    let front = visibleFront();
    while (front?.until !== undefined && front.until <= now && canExpire(front)) {
      if (front.fading) {
        retire(front);
        front = visibleFront();
        continue;
      }
      if (front.progress?.complete) {
        front.fading = true;
        front.pending = undefined;
        front.until = now + 250;
        present({ type: "fade", identity, utteranceId: front.caption.source.utteranceId, durationMs: 250 });
      } else {
        front.partIndex++;
        front.progress = undefined;
        front.until = undefined;
        present({ type: "replay", caption: front.caption, partIndex: front.partIndex });
      }
      break;
    }
    schedule();
  }

  return {
    accept(event: InterpretationEvent, videoRange?: CaptionRevision["videoRange"]): CaptionRevision | undefined {
      if (disposed) return undefined;
      const caption = store.accept(event, videoRange);
      if (!caption) return undefined;
      // The comparison history is independent of overlay retirement and cadence.
      const retained = new Set(store.snapshot().filter((item) => sameIdentity(item.source.identity, identity)).map((item) => item.source.utteranceId));
      for (const [id, entry] of entries) {
        if (!retained.has(id)) { if (!entry.retired) retire(entry); entries.delete(id); }
      }
      const id = caption.source.utteranceId;
      let entry = entries.get(id);
      if (entry?.retired || entry?.fading) return caption;
      if (!entry) {
        entry = { caption, updatedAt: clock.now(), partIndex: 0, fading: false, retired: false };
        entries.set(id, entry);
        paint(entry, caption, true);
      } else {
        const immediate = finalPair(caption)
          || (caption.source.final && caption.source.sourceRevision !== entry.caption.source.sourceRevision)
          || (entry.caption.translation.state === "pending" && caption.translation.state === "paired");
        if (!immediate && clock.now() - entry.updatedAt < 1000) entry.pending = caption;
        else paint(entry, caption, false);
      }
      schedule();
      return caption;
    },
    progress(progress: DisplayProgress): void {
      if (disposed || !sameIdentity(identity, progress.identity)) return;
      const entry = entries.get(progress.utteranceId);
      const translation = entry?.caption.translation;
      if (!entry || entry.retired || entry.fading || translation?.state !== "paired"
        || progress.sourceRevision !== entry.caption.source.sourceRevision
        || progress.translationRevision !== translation.revision.translationRevision
        || progress.partIndex !== entry.partIndex || !Number.isSafeInteger(progress.characterCount) || progress.characterCount < 0) return;
      const old = entry.progress;
      entry.progress = { ...progress, identity: { ...progress.identity } };
      if (!progress.visible) entry.until = undefined;
      else if (entry.until === undefined || !old?.visible || progress.characterCount > old.characterCount) {
        entry.until = Math.max(entry.until ?? 0, clock.now() + Math.min(6000, Math.max(2500, progress.characterCount * 90)));
      }
      schedule();
    },
    retire(utteranceId: string): void {
      const entry = entries.get(utteranceId);
      if (entry && !entry.retired) retire(entry);
      schedule();
    },
    clear(): void {
      if (disposed) return;
      cancelTimer?.();
      cancelTimer = undefined;
      entries.clear();
      store = createRevisionStore(identity, captionHistoryLimit);
      present({ type: "clear", identity });
    },
    activate(next: SessionIdentity): void {
      if (disposed) return;
      cancelTimer?.();
      cancelTimer = undefined;
      present({ type: "clear", identity });
      identity = next;
      entries.clear();
      store.activate(next);
    },
    snapshot(): readonly CaptionRevision[] { return store.snapshot(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelTimer?.();
      cancelTimer = undefined;
      entries.clear();
      present({ type: "clear", identity });
    },
  };
}
