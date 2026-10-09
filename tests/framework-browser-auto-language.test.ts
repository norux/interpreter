import assert from "node:assert/strict";
import { test } from "node:test";
import type { InterpretationEvent, MediaTargetId, TextTranslator } from "../packages/contracts";
import { createBrowserPipeline } from "../packages/engines-browser/pipeline";

const identity = { sessionId: "multilingual", targetId: "tab" as MediaTargetId, epoch: 0 };

test("automatic pipeline pairs alternating languages per utterance and bypasses Korean translation", async () => {
  const calls: string[] = [];
  const translator: TextTranslator = {
    async *translate(source, pair) {
      calls.push(pair.source);
      assert.equal(pair.source, source.language); assert.equal(pair.target, "ko");
      yield { identity, utteranceId: source.utteranceId, sourceRevision: source.sourceRevision,
        translationRevision: 1, final: true, languages: pair, text: `번역 ${source.utteranceId}` };
    }, async cancel() {}, async close() {},
  };
  const pipeline = createBrowserPipeline(identity, { source: "auto", target: "ko" }, () => ({
    async *run() {
      for (const [index, language] of ["en", "ja", "ko", "en"].entries()) yield {
        identity, utteranceId: `turn-${index}`, sourceRevision: 1, final: true, language,
        text: language === "ko" ? "한국어 발화입니다." : `original ${index}`,
        audioRange: { startMs: index * 1000, endMs: (index + 1) * 1000 },
      };
    }, async cancel() {}, async close() {},
  }), translator);
  const events: InterpretationEvent[] = [];
  try {
    for await (const event of pipeline.run((async function* () {})())) events.push(event);
    assert.deepEqual(calls, ["en", "ja", "en"]);
    const originals = events.filter(event => event.type === "transcript");
    assert.deepEqual(originals.map(event => event.revision.language), ["en", "ja", "ko", "en"]);
    const korean = events.find(event => event.type === "translation" && event.revision.utteranceId === "turn-2");
    assert.ok(korean && korean.type === "translation");
    assert.equal(korean.revision.text, "한국어 발화입니다.");
    assert.deepEqual(korean.revision.languages, { source: "ko", target: "ko" });
  } finally { await pipeline.close(); }
});


test("manual Korean pipeline pairs original text without invoking a translator", async () => {
  const pipeline = createBrowserPipeline(identity, { source: "ko", target: "ko" }, () => ({
    async *run() {
      yield { identity, utteranceId: "korean", sourceRevision: 1, final: true, language: "ko", text: "한국어입니다.",
        audioRange: { startMs: 0, endMs: 1000 } };
    }, async cancel() {}, async close() {},
  }), {
    translate() { throw new Error("Korean must bypass translation"); }, async cancel() {}, async close() {},
  });
  try {
    const events: InterpretationEvent[] = [];
    for await (const event of pipeline.run((async function* () {})())) events.push(event);
    const translated = events.find(event => event.type === "translation");
    assert.ok(translated && translated.type === "translation");
    assert.equal(translated.revision.text, "한국어입니다.");
    assert.deepEqual(translated.revision.languages, { source: "ko", target: "ko" });
  } finally { await pipeline.close(); }
});
