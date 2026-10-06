import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaptionRevision, DisplayProgress, MediaTargetId, PresentationEvent, SessionIdentity } from "../packages/contracts";
import { createPresentationPolicy } from "../packages/core/presentation-policy";

const identity: SessionIdentity = { sessionId: "generated", targetId: "video" as MediaTargetId, epoch: 0 };

function caption(revision = 1, final = false, utteranceId = "u1", session = identity): CaptionRevision {
  return {
    source: { identity: session, utteranceId, sourceRevision: revision, text: `generated source ${revision}`,
      final, language: "en", audioRange: { startMs: 0, endMs: 1000 } },
    translation: { state: "paired", revision: { identity: session, utteranceId, sourceRevision: revision,
      translationRevision: revision, languages: { source: "en", target: "ko" }, text: `합성 번역 ${revision}`, final } },
  };
}

function harness() {
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let timerId = 0;
  const events: { at: number; event: PresentationEvent }[] = [];
  const policy = createPresentationPolicy(identity, {
    now: () => now,
    schedule(callback, delayMs) {
      const id = ++timerId;
      timers.set(id, { at: now + delayMs, callback });
      return () => { timers.delete(id); };
    },
  }, (event) => { events.push({ at: now, event }); });
  return {
    policy, events,
    accept: (value: CaptionRevision) => policy.accept({ type: "paired-caption", caption: value }),
    runFor(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    progress(value: CaptionRevision, partIndex = 0, complete = true, characterCount = 10, visible = true) {
      assert.equal(value.translation.state, "paired");
      if (value.translation.state !== "paired") return;
      policy.progress({ identity: value.source.identity, utteranceId: value.source.utteranceId,
        sourceRevision: value.source.sourceRevision, translationRevision: value.translation.revision.translationRevision,
        partIndex, complete, characterCount, visible });
    },
    get timerCount() { return timers.size; },
  };
}

test("first/each utterance is immediate, bursts coalesce at 1000ms and final cancels pending corrections", () => {
  const h = harness();
  h.accept(caption());
  assert.equal(h.events[0].event.type, "insert");
  for (let revision = 2; revision <= 13; revision++) { h.runFor(20); h.accept(caption(revision)); }
  assert.equal(h.events.length, 1);
  assert.equal(h.accept(caption(5)), undefined);
  h.runFor(759);
  assert.equal(h.events.length, 1);
  h.runFor(1);
  assert.equal(h.events[1].at, 1000);
  assert.equal(h.events[1].event.type, "update");
  if (h.events[1].event.type === "update") assert.equal(h.events[1].event.caption.source.sourceRevision, 13);
  h.accept(caption(14));
  h.runFor(200);
  h.accept(caption(15, true));
  assert.equal(h.events.at(-1)?.event.type, "replay");
  assert.equal(h.events.at(-1)?.at, 1200);
  h.runFor(1000);
  assert.equal(h.events.length, 3);
  assert.equal(h.accept(caption(16)), undefined);
  h.accept(caption(1, false, "u2"));
  assert.equal(h.events.at(-1)?.event.type, "insert");
});

test("pending source paints immediately and source final alone cannot initiate translation replay", () => {
  const h = harness();
  const c = caption();
  h.policy.accept({ type: "transcript", revision: c.source });
  assert.equal(h.events[0].event.type, "insert");
  h.accept(c);
  assert.equal(h.events.length, 2, "First useful translation bypasses cadence");
  const final = caption(2, true);
  h.policy.accept({ type: "transcript", revision: final.source });
  assert.equal(h.events.at(-1)?.event.type, "update");
  if (final.translation.state !== "paired") throw new Error("Fixture must be paired");
  h.policy.accept({ type: "translation", revision: { ...final.translation.revision, final: false } });
  assert.equal(h.events.at(-1)?.event.type, "update");
  h.policy.accept({ type: "translation", revision: { ...final.translation.revision, translationRevision: 3 } });
  assert.equal(h.events.at(-1)?.event.type, "replay");
  const latest = h.policy.snapshot()[0];
  h.policy.accept({ type: "transcript", revision: { ...final.source, sourceRevision: 3 } });
  assert.equal(h.policy.snapshot()[0].translation.state, "pending", "Never pair an old translation with new source");
  assert.equal(h.events.at(-1)?.event.type, "update", "Final source corrections clear the stale pair immediately");
  assert.equal(latest.translation.state, "paired");
});

test("long final replay advances only acknowledged parts then fades for exactly 250ms; expired updates stay in history", () => {
  const h = harness();
  const partial = caption();
  h.accept(partial);
  h.progress(partial, 0, false);
  h.runFor(2500);
  assert.equal(h.events.at(-1)?.event.type, "replay");
  h.progress(partial, 1, false);
  const final = caption(2, true);
  h.accept(final);
  assert.deepEqual(h.events.at(-1)?.event, { type: "replay", caption: final, partIndex: 0 });
  h.progress(partial, 1, true, 100);
  h.runFor(10000);
  assert.equal(h.events.length, 3, "Stale renderer completion cannot expire a new final");
  h.progress(final, 0, false, 40);
  h.runFor(3599);
  assert.equal(h.events.length, 3);
  h.runFor(1);
  assert.deepEqual(h.events.at(-1)?.event, { type: "replay", caption: final, partIndex: 1 });
  h.progress(final, 0, true);
  h.runFor(5000);
  assert.equal(h.events.length, 4, "Old part acknowledgement cannot skip an unread part");
  h.progress(final, 1, false, 100);
  h.runFor(5999);
  assert.equal(h.events.length, 4);
  h.runFor(1);
  assert.equal(h.events.at(-1)?.event.type, "replay");
  h.progress(final, 2, true, 1);
  h.runFor(2500);
  assert.deepEqual(h.events.at(-1)?.event, { type: "fade", identity, utteranceId: "u1", durationMs: 250 });
  h.accept(caption(3, true));
  h.runFor(249);
  assert.equal(h.events.at(-1)?.event.type, "fade");
  h.runFor(1);
  assert.equal(h.events.at(-1)?.event.type, "remove");
  const count = h.events.length;
  h.accept(caption(4, true));
  assert.equal(h.events.length, count, "Retired overlays cannot reappear");
  assert.equal(h.policy.snapshot()[0].source.sourceRevision, 4, "Comparison still receives full latest records");
});

test("reading holds latest provisional, expires in order and hidden layout does not spend reading time", () => {
  const h = harness();
  const first = caption();
  h.accept(first);
  h.progress(first);
  h.runFor(10000);
  assert.equal(h.events.length, 1, "Only provisional ending must await correction/final");
  assert.equal(h.timerCount, 0, "No polling an indefinitely held provisional");
  const next = caption(1, true, "u2");
  h.accept(next);
  h.progress(next, 0, true, 10, false);
  h.runFor(1);
  assert.equal(h.events.at(-1)?.event.type, "fade");
  h.runFor(250);
  assert.equal(h.events.at(-1)?.event.type, "remove");
  h.runFor(10000);
  assert.equal(h.events.length, 4, "Hidden text does not expire");
  h.progress(next);
  h.runFor(2499);
  assert.equal(h.events.length, 4);
  h.runFor(1);
  assert.equal(h.events.at(-1)?.event.type, "fade");
});

test("layout acknowledgements preserve deadlines, grant time for extension, and reject malformed progress", () => {
  const h = harness();
  const final = caption(1, true);
  h.accept(final);
  h.progress(final);
  h.runFor(1000);
  h.progress(final);
  const invalid: DisplayProgress = { identity, utteranceId: "u1", sourceRevision: 1, translationRevision: 1,
    partIndex: 0, complete: true, visible: true, characterCount: NaN };
  h.policy.progress(invalid);
  h.runFor(1499);
  assert.equal(h.events.length, 1);
  h.runFor(1);
  assert.equal(h.events.at(-1)?.event.type, "fade");

  const extension = harness();
  extension.accept(final);
  extension.progress(final);
  extension.runFor(2000);
  extension.progress(final, 0, true, 50);
  extension.runFor(4499);
  assert.equal(extension.events.length, 1);
  extension.runFor(1);
  assert.equal(extension.events.at(-1)?.event.type, "fade");
});

test("recent 300 history, eviction, retirement, epoch clear and dispose cancel delayed work", () => {
  const h = harness();
  for (let index = 0; index < 301; index++) {
    const c = caption(1, true, `u${index}`);
    h.accept({ ...c, source: { ...c.source, audioRange: { startMs: index * 1000, endMs: (index + 1) * 1000 } } });
  }
  assert.equal(h.policy.snapshot().length, 300);
  assert.equal(h.policy.snapshot()[0].source.utteranceId, "u1");
  assert.equal(h.accept(caption(2, true, "u0")), undefined);
  h.policy.retire("u1");
  const count = h.events.length;
  h.accept({ ...caption(2, true, "u1"), source: { ...caption(2, true, "u1").source, audioRange: { startMs: 1000, endMs: 2000 } } });
  assert.equal(h.events.length, count);
  const next = { ...identity, epoch: 1 };
  h.policy.activate(next);
  assert.equal(h.events.at(-1)?.event.type, "clear");
  assert.equal(h.accept(caption(3, true)), undefined);
  h.accept(caption(1, false, "fresh", next));
  h.accept(caption(2, false, "fresh", next));
  h.progress(caption(1, true), 0, true);
  assert.equal(h.timerCount, 1);
  h.policy.dispose();
  h.policy.dispose();
  assert.equal(h.timerCount, 0);
  const disposedCount = h.events.length;
  h.runFor(10000);
  assert.equal(h.events.length, disposedCount);
  assert.equal(h.accept(caption(3, true, "fresh", next)), undefined);
  assert.equal(h.policy.snapshot().length, 300, "Stop retains comparison history");
});

test("explicit clear cancels cadence and resets history while keeping the output reusable", () => {
  const h = harness();
  h.accept(caption());
  h.accept(caption(2));
  h.policy.clear();
  assert.equal(h.timerCount, 0);
  assert.equal(h.policy.snapshot().length, 0);
  assert.equal(h.events.at(-1)?.event.type, "clear");
  h.accept(caption());
  h.runFor(1000);
  assert.equal(h.events.at(-1)?.event.type, "insert");
  assert.equal(h.events.length, 3, "Cleared pending correction cannot leak into a reused sink");
});
