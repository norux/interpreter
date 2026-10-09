import type { CaptionRevision, LanguagePair, SessionIdentity, TextTranslator, TranscriptRevision } from "../contracts";
import { sameIdentity } from "../core/identity";
import { createRevisionStore } from "../core/revision-store";

function fillerOnly(text: string, language: string) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const words = (language === "ja" ? normalized.replace(/[〜~]/gu, "ー") : normalized)
    .replace(/[\p{P}\p{S}]/gu, " ").trim().split(/\s+/);
  // Only suppress entire filler utterances; short answers and sentence content
  // stay intact, including an interjection followed by meaningful speech.
  const filler = language === "en" ? /^(?:u+h+|u+m+|h+m+|m+h+m+|e+r+m*|a+h+|o+h+)$/
    : language === "ja" ? /^(?:え[えー]*|あ[あー]*|お[おー]*|うー+ん+|んー+|えー*っと)$/
    : language === "ko" ? /^(?:음+|어+|오+|아+|흠+|으+음+)$/ : undefined;
  return words.every(word => !word || filler?.test(word));
}

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
      const requested = pair.source === "auto" ? { source: source.language, target: pair.target } : pair;
      for await (const revision of translator.translate(source, requested)) {
        if (stopped) return;
        const caption = store.accept({ type: "translation", revision });
        if (caption) receive(caption);
      }
    } catch { if (!stopped) fail("engine-failed"); }
    finally { active = undefined; if (!stopped) void drain(); settled(); }
  }

  return {
    accept(source: TranscriptRevision): boolean {
      if (stopped || !sameIdentity(selected, source.identity) || (pair.source === "auto"
        ? !["en", "ja", "ko"].includes(source.language) : source.language !== pair.source) || !source.text || source.text.length > 16384
        || fillerOnly(source.text, source.language)) return false;
      const caption = store.accept({ type: "transcript", revision: source });
      if (!caption) return false;
      receive(caption); // ASR paints now, with pending translation for this revision.
      if ((pair.source === "auto" || pair.source === "ko") && source.language === pair.target) {
        pending.delete(source.utteranceId);
        const paired = store.accept({ type: "translation", revision: { identity: source.identity, utteranceId: source.utteranceId,
          sourceRevision: source.sourceRevision, translationRevision: source.sourceRevision,
          languages: { source: source.language, target: pair.target }, text: source.text, final: source.final } });
        if (paired) receive(paired);
        return true;
      }
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
