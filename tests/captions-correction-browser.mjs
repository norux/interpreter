// Built DOM output with stubbed runtime messages and a controlled browser clock.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date("2026-10-06T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-06T00:00:01Z"));
  await page.setContent("<!doctype html><title>Caption correction cadence</title>");
  await page.evaluate(() => {
    globalThis.chrome = { runtime: { id: "cadence-fixture", onMessage: {
      addListener(listener) { globalThis.sendCaption = (message) => listener(message, { id: "cadence-fixture" }); },
    } } };
  });
  await page.addScriptTag({ path: resolve("extension/dist/content.js") });
  const base = { sessionId: "cadence", utteranceId: "one", revision: 1, source: "Generated speech",
    translation: "처음 표시한 번역", final: false, audioStartMs: 0, audioEndMs: 1000, emittedAtMs: Date.now() };
  async function send(message) {
    await page.evaluate((message) => globalThis.sendCaption({ target: "captions", ...message }), message);
  }
  const sentence = page.locator(".sentence");
  await send({ type: "start", sessionId: base.sessionId });
  await send({ type: "caption", caption: base });
  assert.equal(await sentence.textContent(), base.translation, "First output must remain immediate");
  await sentence.evaluate((node) => { globalThis.originalSentence = node; });
  for (let i = 1; i <= 12; i++) {
    await page.clock.runFor(20);
    await send({ type: "caption", caption: { ...base, revision: i + 1, translation: `교정 ${i}` } });
  }
  assert.equal(await sentence.textContent(), base.translation,
    "A token burst must not continually rewrite the displayed sentence");
  await send({ type: "caption", caption: { ...base, revision: 5, translation: "뒤늦은 교정" } });
  await page.clock.runFor(759);
  assert.equal(await sentence.textContent(), base.translation);
  await page.clock.runFor(1);
  assert.equal(await sentence.textContent(), "교정 12", "Show only the latest queued correction at one second");
  assert.equal(await sentence.evaluate((node) => node === globalThis.originalSentence), true);

  await send({ type: "caption", caption: { ...base, revision: 14, translation: "대기 교정" } });
  await page.clock.runFor(200);
  await send({ type: "caption", caption: { ...base, revision: 15, translation: "확정된 번역입니다.", final: true } });
  assert.equal(await sentence.textContent(), "확정된 번역입니다.", "Final output bypasses the correction delay");
  await page.clock.runFor(1000);
  assert.equal(await sentence.textContent(), "확정된 번역입니다.", "A queued partial cannot overwrite the final");

  await send({ type: "caption", caption: { ...base, utteranceId: "two", audioStartMs: 1000 } });
  assert.equal(await sentence.last().textContent(), base.translation, "Each new utterance gets immediate first output");
  await send({ type: "caption", caption: { ...base, utteranceId: "two", audioStartMs: 1000, revision: 2, translation: "취소할 교정" } });
  await send({ type: "clear", sessionId: base.sessionId });
  await page.clock.runFor(1500);
  assert.equal(await page.locator("#interpreter-captions").count(), 0, "Clear cancels delayed display work");

  await send({ type: "start", sessionId: base.sessionId });
  await send({ type: "caption", caption: base });
  await send({ type: "caption", caption: { ...base, revision: 2, translation: "이전 세션 교정" } });
  await send({ type: "start", sessionId: "replacement" });
  await send({ type: "caption", caption: { ...base, sessionId: "replacement", translation: "새 세션 자막" } });
  await page.clock.runFor(1500);
  assert.equal(await sentence.textContent(), "새 세션 자막", "Replacement rejects pending old-session output");
  console.log(JSON.stringify({ passed: true, browser: browser.version(), correctionIntervalMs: 1000,
    immediateFirst: true, burstCoalesced: true, latestRevision: true, immediateFinal: true,
    inPlace: true, clear: true, replacement: true, realAudioOrModels: false }));
} finally {
  await browser.close();
}
