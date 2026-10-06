// Generated captions test overlap against the built sink; no audio/model claim.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

await mkdir(".ralph", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/captions-overlap-"));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><title>Caption overlap</title><button>Control</button>');
});
let context;
try {
  await new Promise((ready) => server.listen(8766, "127.0.0.1", ready));
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 270, height: 700 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = context.pages()[0];
  await page.goto("http://127.0.0.1:8766/");
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  assert.ok(tabId);
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  async function send(message) {
    await worker.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, { target: "captions", ...message }), { id: tabId, message });
  }
  const texts = ["파란 우산과 따뜻한 코트를 챙겨 여행을 위해 오후 세 시에 역에서 만나세요.",
    "내일은 비가 옵니다. 빨간 가방을 챙겨 집에서 여덟 시에 출발하세요."];
  await page.evaluate((texts) => {
    globalThis.overlapViews = [];
    const observer = new MutationObserver(() => {
      const cue = document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".cue");
      if (!cue?.textContent) return;
      const text = cue.textContent;
      const index = texts.findIndex((full) => full.includes(text));
      globalThis.overlapViews.push({ text, index,
        offset: index < 0 ? -1 : texts[index].indexOf(text),
        twoLines: cue.clientHeight <= Number.parseFloat(getComputedStyle(cue).lineHeight) * 2 + 9 });
    });
    globalThis.watchOverlap = () => {
      observer.observe(document.querySelector("#interpreter-captions").shadowRoot, { childList: true, characterData: true, subtree: true });
    };
  }, texts);
  const caption = { sessionId: "overlap", utteranceId: "one", revision: 1, source: "Generated",
    translation: texts[0], final: true, audioStartMs: 0, audioEndMs: 5100, emittedAtMs: Date.now() };
  await send({ type: "start", sessionId: caption.sessionId });
  await send({ type: "caption", caption });
  await page.evaluate(() => globalThis.watchOverlap());
  // Include the already-painted first part before the observer was attached.
  const initial = await page.locator("#interpreter-captions .cue").evaluate((cue) => ({ text: cue.textContent, index: 0, offset: 0,
    twoLines: cue.clientHeight <= Number.parseFloat(getComputedStyle(cue).lineHeight) * 2 + 9 }));
  await page.waitForTimeout(100);
  await send({ type: "caption", caption: { ...caption, utteranceId: "two", translation: texts[1].slice(0, 10), final: false } });
  await send({ type: "caption", caption: { ...caption, utteranceId: "two", revision: 2, translation: texts[1] } });
  await send({ type: "caption", caption: { ...caption, utteranceId: "two", translation: "오래된 응답" } });
  const deadline = Date.now() + 20000;
  while (await page.locator("#interpreter-captions").count()) {
    assert.ok(Date.now() < deadline, "Overlapping captions did not expire");
    await page.waitForTimeout(50);
  }
  const views = await page.evaluate(() => globalThis.overlapViews);
  views.unshift(initial);
  const samples = [];
  for (const [index, text] of texts.entries()) {
    const seen = new Set();
    for (const view of views.filter((v) => v.index === index)) {
      assert.ok(view.twoLines);
      for (let i = view.offset; i < view.offset + view.text.length; i++) seen.add(i);
    }
    assert.equal(seen.size, text.length, `Utterance ${index + 1}: unread final characters were lost`);
    samples.push({ utterance: index + 1, characterCount: text.length, displayedCharacterCount: seen.size,
      parts: views.filter((v) => v.index === index).map(({ text, ...view }) => ({ ...view, length: text.length })) });
  }
  assert.ok(views.every((v) => v.index >= 0), "An old queued revision overwrote its final");
  await send({ type: "caption", caption });
  await send({ type: "caption", caption: { ...caption, utteranceId: "two", translation: texts[1] } });
  await send({ type: "clear", sessionId: caption.sessionId });
  await page.waitForTimeout(2800);
  assert.equal(await page.locator("#interpreter-captions").count(), 0, "Clear must discard queued captions and timers");
  const warnings = [];
  page.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
  await send({ type: "start", sessionId: caption.sessionId });
  await send({ type: "caption", caption });
  await page.evaluate(() => {
    globalThis.burstViews = [];
    const shadow = document.querySelector("#interpreter-captions").shadowRoot;
    const observer = new MutationObserver(() => globalThis.burstViews.push(shadow.querySelector(".cue").textContent));
    observer.observe(shadow, { childList: true, subtree: true, characterData: true });
  });
  for (let i = 0; i < 10; i++) {
    await send({ type: "caption", caption: { ...caption, utteranceId: `burst-${i}`,
      translation: `대기 ${i}`, audioEndMs: 1000 } });
  }
  assert.equal(warnings.length, 8, "A burst must explicitly report discarded waiting captions");
  await page.waitForFunction(() => globalThis.burstViews.includes("8"), null, { timeout: 9000 }).catch(async (error) => {
    console.log(JSON.stringify({ burstFailure: await page.evaluate(() => globalThis.burstViews) }));
    throw error;
  });
  assert.deepEqual(await page.evaluate(() => globalThis.burstViews.slice(-2)), ["대기 ", "8"], "Keep the two newest waiting captions, including every part");
  // A session replacement must dispose both the current cue and its pending timer.
  await send({ type: "start", sessionId: "replacement" });
  await send({ type: "caption", caption: { ...caption, sessionId: "replacement", translation: "교체." } });
  await send({ type: "caption", caption: { ...caption, revision: 99, translation: "이전 세션" } });
  assert.equal(await page.locator("#interpreter-captions .cue").textContent(), "교체.");
  await page.waitForTimeout(2800);
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  // Two 5.1-second waiting phrases exceed the separate eight-second audio budget.
  await send({ type: "start", sessionId: caption.sessionId });
  await send({ type: "caption", caption });
  await send({ type: "caption", caption: { ...caption, utteranceId: "budget-one", translation: "대기 하나" } });
  await send({ type: "caption", caption: { ...caption, utteranceId: "budget-two", translation: "대기 둘" } });
  assert.equal(warnings.length, 9);
  await page.waitForFunction(() => document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".cue")?.textContent === "둘", null, { timeout: 9000 });
  assert.equal(await page.locator("#interpreter-captions .cue").textContent(), "둘");
  await send({ type: "clear", sessionId: caption.sessionId });
  const report = { passed: true, browser: context.browser().version(), generatedCaptions: true, samples,
    audioTranslation: "not exercised", allCharactersDisplayed: true, queuedRevisionRejected: true, clear: true,
    boundedWaitingCount: 2, boundedWaitingAudioMs: 8000, overloadWarnings: warnings.length, replacement: true };
  await writeFile("docs/verification/latency/overlap-fixture.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  await context?.close();
  await new Promise((closed) => server.close(closed));
}
