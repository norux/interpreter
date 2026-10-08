import type { CaptionRevision, LanguagePair, SessionIdentity, TextTranslator, TranscriptRevision } from "../contracts";
import { sameIdentity } from "../core/identity";
import { createRevisionStore } from "../core/revision-store";

export function createTranslationQueue(identity: SessionIdentity, languages: LanguagePair, translator: TextTranslator,
  maxPendingUtterances: number, maxStoredCaptions: number,
  receive: (caption: CaptionRevision) => void, fail: (reason: "overloaded" | "engine-failed") => void) {
  if (!Number.isSafeInteger(maxPendingUtterances) || maxPendingUtterances <= 0) throw new Error("Translation limit must be a positive integer");
  const selected = { ...identity }; const pair = { ...languages };
  const store = createRevisionStore(selected, maxStoredCaptions);
  const pending = new Map<string, TranscriptRevision>();
  let active: TranscriptRevision | undefined;
  let stopped = false;
  const waiters = new Set<() => void>();

  function settled() {
    if (!stopped && (active || pending.size)) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  }

  async function drain() {
    if (active || stopped) return;
    const source = [...pending.values()].find(source => source.final) ?? pending.values().next().value;
    if (!source) return;
    pending.delete(source.utteranceId); active = source;
    try {
      for await (const revision of translator.translate(source, pair)) {
        if (stopped) return;
        const caption = store.accept({ type: "translation", revision });
        if (caption) receive(caption);
      }
    } catch { if (!stopped) fail("engine-failed"); }
    finally { active = undefined; if (!stopped) void drain(); settled(); }
  }

  return {
    accept(source: TranscriptRevision): boolean {
      if (stopped || !sameIdentity(selected, source.identity) || source.language !== pair.source || !source.text || source.text.length > 16384) return false;
      const caption = store.accept({ type: "transcript", revision: source });
      if (!caption) return false;
      receive(caption); // ASR paints now, with pending translation for this revision.
      // An active revision and its queued replacement are one utterance. Count
      // unique IDs so a final can replace an active partial even at the limit.
      const utterances = new Set(pending.keys());
      if (active) utterances.add(active.utteranceId);
      if (!utterances.has(source.utteranceId) && utterances.size >= maxPendingUtterances) {
        const provisional = [...pending.values()].find(job => !job.final && job.utteranceId !== active?.utteranceId);
        if (provisional) pending.delete(provisional.utteranceId);
        else { fail("overloaded"); return false; }
      }
      pending.set(source.utteranceId, caption.source);
      void drain();
      return true;
    },
    snapshot: () => store.snapshot(),
    // Input EOF must drain accepted translations before its engine stream ends.
    whenIdle(): Promise<void> {
      if (stopped || (!active && !pending.size)) return Promise.resolve();
      return new Promise(resolve => { waiters.add(resolve); });
    },
    async cancel() {
      if (stopped) return;
      stopped = true; pending.clear();
      settled();
      await translator.cancel(selected);
    },
  };
}
