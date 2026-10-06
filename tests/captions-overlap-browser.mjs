// Built DOM sink regression; generated captions are not audio/model evidence.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { traceCaptionPaints } from "./caption-paint.mjs";

await mkdir(".ralph", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/captions-rolling-"));
const fixture = await readFile("tests/fixtures/captions.html");
const server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(fixture); });
let context;
try {
  await new Promise((ready) => server.listen(8766, "127.0.0.1", ready));
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
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
  const base = { sessionId: "rolling", utteranceId: "one", revision: 1, source: "Generated",
    translation: "오늘은 맑습니다.", final: true, audioStartMs: 0, audioEndMs: 1000, emittedAtMs: Date.now() };
  const cue = page.locator("#interpreter-captions .cue");
  await send({ type: "start", sessionId: base.sessionId });
  await send({ type: "caption", caption: base });
  await page.waitForTimeout(700);
  await send({ type: "caption", caption: { ...base, utteranceId: "two", translation: "공원으로 걸어갑니다.", audioStartMs: 1000, audioEndMs: 2000 } });
  assert.match(await cue.textContent(), /오늘은 맑습니다\..*공원으로 걸어갑니다\./su, "New text must coexist with the previous final");
  const firstNode = await page.locator(".sentence").first().evaluate((node) => { globalThis.firstSentence = node; return true; });
  assert.ok(firstNode);
  await send({ type: "caption", caption: { ...base, utteranceId: "two", revision: 2,
    translation: "점심 뒤 공원으로 갑니다.", final: false, audioStartMs: 1000, audioEndMs: 2000 } });
  // A final cannot regress to a partial even when its revision increases.
  assert.match(await cue.textContent(), /공원으로 걸어갑니다/);
  await send({ type: "caption", caption: { ...base, utteranceId: "two", revision: 3,
    translation: "점심 뒤 공원으로 갑니다.", audioStartMs: 1000, audioEndMs: 2000 } });
  assert.equal(await page.locator(".sentence").first().evaluate((node) => node === globalThis.firstSentence), true);
  await page.waitForFunction(() => document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".sentence")?.style.opacity === "0",
    null, { timeout: 2400 });
  const fading = await page.locator(".sentence").first().evaluate(async (node) => {
    await new Promise((ready) => requestAnimationFrame(() => requestAnimationFrame(ready)));
    return { connected: node.isConnected, opacity: Number(getComputedStyle(node).opacity) };
  });
  assert.ok(fading.connected && fading.opacity > 0 && fading.opacity < 1,
    "An expired sentence must fade while still attached before removal");
  await page.waitForFunction(() => !document.querySelector("#interpreter-captions")?.shadowRoot?.textContent.includes("오늘은 맑습니다."), null, { timeout: 2400 });
  assert.match(await cue.textContent(), /점심 뒤 공원/);
  await send({ type: "caption", caption: { ...base, revision: 99, translation: "만료 문장 부활" } });
  assert.doesNotMatch(await cue.textContent(), /부활/);
  await send({ type: "clear", sessionId: base.sessionId });

  await send({ type: "start", sessionId: base.sessionId });
  const partials = ["파란 우산을 챙깁니다.", "역에서 만납니다."];
  for (let i = 0; i < 2; i++) await send({ type: "caption", caption: { ...base,
    utteranceId: `partial-${i}`, translation: partials[i], final: false, audioStartMs: i * 1000 } });
  await page.locator(".sentence").evaluateAll((nodes) => { globalThis.originalNodes = nodes; });
  for (let i = 0; i < 2; i++) await send({ type: "caption", caption: { ...base,
    utteranceId: `partial-${i}`, revision: 2, translation: `${partials[i]} 오후 세 시입니다.`, final: false, audioStartMs: i * 1000 } });
  await page.waitForFunction((texts) => {
    const nodes = document.querySelector("#interpreter-captions")?.shadowRoot?.querySelectorAll(".sentence");
    return nodes?.length === texts.length && [...nodes].every((node, i) => node.textContent === texts[i]);
  }, partials.map((text) => `${text} 오후 세 시입니다.`));
  assert.equal(await page.locator(".sentence").evaluateAll((nodes) => nodes.every((node, i) => node === globalThis.originalNodes[i])), true);
  assert.equal(await page.locator(".sentence").count(), 2);
  await send({ type: "caption", caption: { ...base, utteranceId: "partial-0", translation: "오래된 응답" } });
  assert.doesNotMatch(await cue.textContent(), /오래된/);
  await send({ type: "clear", sessionId: base.sessionId });

  // A provisional phrase can finish reading while speech and its correction continue.
  await send({ type: "start", sessionId: base.sessionId });
  await send({ type: "caption", caption: { ...base, translation: "나는 보았다.", final: false } });
  await page.waitForTimeout(2700);
  assert.deepEqual(await page.locator(".sentence").allTextContents(), ["나는 보았다."], "The latest provisional cue must survive until finalization");
  await send({ type: "caption", caption: { ...base, revision: 2, translation: "건설 현장에서 크레인을 보았다." } });
  assert.equal(await cue.textContent(), "건설 현장에서 크레인을 보았다.");
  await page.waitForTimeout(1000);
  assert.equal(await cue.textContent(), "건설 현장에서 크레인을 보았다.", "Finalization grants the corrected cue its reading time");
  await page.waitForFunction(() => !document.querySelector("#interpreter-captions"), null, { timeout: 3000 });
  await send({ type: "caption", caption: { ...base, revision: 3, translation: "만료 문장 부활" } });
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  await send({ type: "start", sessionId: base.sessionId });
  await send({ type: "caption", caption: { ...base, translation: "미확정.", final: false } });
  await page.waitForTimeout(2700);
  await send({ type: "caption", caption: { ...base, utteranceId: "next", translation: "다음 문장.", audioStartMs: 1000 } });
  await page.waitForFunction(() => document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".cue")?.textContent === "다음 문장.", null, { timeout: 1000 });
  assert.equal(await cue.textContent(), "다음 문장.", "A newer utterance retires a fully read provisional cue");
  await send({ type: "caption", caption: { ...base, revision: 4, translation: "늦은 확정" } });
  assert.equal(await cue.textContent(), "다음 문장.");
  await send({ type: "clear", sessionId: base.sessionId });

  const texts = ["파란 우산과 따뜻한 코트를 챙겨 여행을 위해 오후 세 시에 역에서 만나세요.",
    "내일은 비가 옵니다. 빨간 가방을 챙겨 집에서 여덟 시에 출발하세요."];
  const samples = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 270, height: 700 }]) {
    await page.setViewportSize(viewport);
    await send({ type: "start", sessionId: base.sessionId });
    await page.evaluate(() => {
      globalThis.views = [];
      globalThis.recordView = () => {
        const cue = document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".cue");
        if (!cue) return;
        const now = performance.now();
        const line = Number.parseFloat(getComputedStyle(cue).lineHeight);
        globalThis.views.push({ at: now, height: cue.clientHeight, line,
          sentences: [...cue.querySelectorAll(".sentence")].map((node) => ({ id: node.dataset.utteranceId,
            text: node.textContent, height: node.clientHeight, line })) });
      };
      globalThis.watcher = new MutationObserver(globalThis.recordView);
    });
    for (let i = 0; i < 2; i++) {
      await send({ type: "caption", caption: { ...base, utteranceId: `long-${i}`, translation: texts[i], audioStartMs: i * 2000, audioEndMs: (i + 1) * 2000 } });
      if (i === 0) await page.evaluate(() => globalThis.watcher.observe(document.querySelector("#interpreter-captions").shadowRoot, { childList: true, subtree: true, characterData: true }));
      await page.evaluate(() => globalThis.recordView());
    }
    assert.equal(await page.locator(".sentence").count(), 2);
    const name = viewport.width === 270 ? "rolling-narrow" : "rolling-normal";
    await page.screenshot({ path: `docs/verification/captions/${name}.png` });
    await page.locator("#play").click();
    assert.equal(await page.locator("#play").textContent(), "Clicked");
    const before = await page.locator(".sentence").allTextContents();
    await page.locator("#fullscreen").click();
    await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector("#interpreter-captions")));
    assert.deepEqual(await page.locator(".sentence").allTextContents(), before, "Fullscreen must retain the current reading position");
    if (viewport.width === 1280) await page.screenshot({ path: "docs/verification/captions/rolling-fullscreen.png" });
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => document.fullscreenElement === null);
    await page.waitForFunction(() => !document.querySelector("#interpreter-captions"), null, { timeout: 20000 });
    const views = await page.evaluate(() => { globalThis.watcher.disconnect(); globalThis.views.push({ at: performance.now(), height: 0, line: 1, sentences: [] }); return globalThis.views; });
    assert.ok(views.every((v) => v.height <= v.line * 4 + 9), "Rolling surface must fit four lines without clipping");
    const parts = texts.map((full, i) => {
      const changes = [];
      for (const view of views) {
        const sentence = view.sentences.find((s) => s.id === `long-${i}`);
        if (sentence && sentence.text !== changes.at(-1)?.text) changes.push({ ...sentence, at: view.at });
      }
      assert.equal(changes.map((c) => c.text).join(""), full, "Every final character appears once, in order");
      assert.ok(changes.every((c) => c.height <= c.line * 2 + 1));
      for (let part = 0; part < changes.length; part++) {
        const change = changes[part];
        const end = changes[part + 1]?.at ?? views.find((v) => v.at > change.at && !v.sentences.some((s) => s.id === `long-${i}`))?.at;
        change.hiddenAtMs = end;
        assert.ok(end - change.at >= Math.min(6000, Math.max(2500, change.text.length * 90)) - 100, "Each part needs its reading time");
      }
      return { utterance: i, characterCount: full.length, displayedCharacterCount: changes.reduce((n, c) => n + c.text.length, 0),
        parts: changes.map(({ text, ...c }) => ({ ...c, length: text.length })) };
    });
    const firstMissing = [0, 1].map((i) => views.findIndex((v) => !v.sentences.some((s) => s.id === `long-${i}`) && v.at > views.find((v) => v.sentences.some((s) => s.id === `long-${i}`)).at));
    assert.ok(firstMissing[0] <= firstMissing[1], "Remove the front sentence first");
    samples.push({ viewport, parts, maxSurfaceHeight: Math.max(...views.map((v) => v.height)), coexistence: true, frontExpiry: true });
  }

  // A resize after the first part expires must keep the suffix, without replaying the prefix.
  await page.setViewportSize({ width: 270, height: 700 });
  await send({ type: "start", sessionId: base.sessionId });
  await send({ type: "caption", caption: { ...base, translation: texts[0] } });
  const prefix = await page.locator(".sentence").textContent();
  await page.waitForFunction((prefix) => document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".sentence")?.textContent !== prefix, prefix, { timeout: 7000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.locator(".sentence").textContent(), texts[0].slice(prefix.length));
  await send({ type: "clear", sessionId: base.sessionId });

  // Context corrections can change the length of a prefix that has already been read.
  await page.setViewportSize({ width: 270, height: 700 });
  const finishCorrectionTrace = await traceCaptionPaints(context, page, worker, tabId);
  await send({ type: "start", sessionId: base.sessionId });
  const provisional = "여행을 준비하며 파란 우산과 따뜻한 코트를 챙기고 오후 세 시에 역에서 만나세요.";
  await send({ type: "caption", caption: { ...base, translation: provisional, final: false } });
  const readPrefix = await page.locator(".sentence").textContent();
  assert.ok(readPrefix.length < provisional.length);
  await page.waitForFunction((prefix) => document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".sentence")?.textContent !== prefix,
    readPrefix, { timeout: 7000 });
  const visibleSuffix = await page.locator(".sentence").textContent();
  await page.locator(".sentence").evaluate((node) => { globalThis.correctedSentence = node; });
  const unreadSuffix = provisional.slice(readPrefix.length);
  await send({ type: "caption", caption: { ...base, revision: 2, translation: `준비하며 ${unreadSuffix}`, final: false } });
  assert.equal(await page.locator(".sentence").textContent(), visibleSuffix,
    "Shortening a read prefix must preserve the visible suffix rather than skip its characters");
  await send({ type: "caption", caption: { ...base, revision: 3, translation: `여행 준비를 모두 마친 다음에는 ${unreadSuffix}`, final: false } });
  assert.equal(await page.locator(".sentence").textContent(), visibleSuffix,
    "Lengthening a read prefix must not replay its words into the visible suffix");
  assert.equal(await page.locator(".sentence").evaluate((node) => node === globalThis.correctedSentence), true);
  const finalText = `여행 준비를 모두 마친 다음에는 ${unreadSuffix}`;
  await send({ type: "caption", caption: { ...base, revision: 4, translation: finalText } });
  const finalPrefix = await page.locator(".sentence").textContent();
  assert.ok(finalText.startsWith(finalPrefix) && finalPrefix !== visibleSuffix,
    "Finalization must replay the complete translation from its beginning");
  await page.screenshot({ path: ".ralph/reading-position-corrected.png" });
  await page.waitForTimeout(1000);
  assert.equal(await page.locator(".sentence").textContent(), finalPrefix, "The final correction grants fresh reading time");
  await send({ type: "caption", caption: { ...base, revision: 2, translation: "오래된 임시 응답", final: false } });
  assert.equal(await page.locator(".sentence").textContent(), finalPrefix);
  await page.evaluate(() => {
    globalThis.finalParts = [document.querySelector("#interpreter-captions").shadowRoot.querySelector(".sentence").textContent];
    globalThis.finalWatcher = new MutationObserver(() => {
      const text = document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".sentence")?.textContent;
      if (text && text !== globalThis.finalParts.at(-1)) globalThis.finalParts.push(text);
    });
    globalThis.finalWatcher.observe(document.querySelector("#interpreter-captions").shadowRoot, { childList: true, subtree: true, characterData: true });
  });
  await page.waitForFunction(() => !document.querySelector("#interpreter-captions"), null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => { globalThis.finalWatcher.disconnect(); return globalThis.finalParts.join(""); }), finalText,
    "The final replay must display every character in order before expiring");
  await send({ type: "clear", sessionId: base.sessionId });
  const correctionTrace = await finishCorrectionTrace();
  assert.ok(correctionTrace.find((row) => row.revision === 4)?.visible,
    "Paint instrumentation must recognize the restarted final translation");

  // A replacement of the current part must show its corrected words from the edit.
  await send({ type: "start", sessionId: base.sessionId });
  await send({ type: "caption", caption: { ...base, translation: provisional, final: false } });
  await page.waitForFunction((prefix) => document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".sentence")?.textContent !== prefix,
    readPrefix, { timeout: 7000 });
  await send({ type: "caption", caption: { ...base, revision: 2, translation: "내일 아침에 공원에서 만나요." } });
  assert.equal(await page.locator(".sentence").textContent(), "내일 아침에 공원에서 만나요.",
    "Rewriting the current part must display the new words without an offset from the obsolete text");
  await send({ type: "clear", sessionId: base.sessionId });

  // Overload is visible, counted, and bounded separately from the active sentences.
  await page.setViewportSize({ width: 1280, height: 800 });
  const warnings = [];
  page.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
  await send({ type: "start", sessionId: base.sessionId });
  for (let i = 0; i < 12; i++) await send({ type: "caption", caption: { ...base,
    utteranceId: `burst-${i}`, translation: `문장${i}`, audioStartMs: 0, audioEndMs: 1000 } });
  assert.equal(warnings.length, 4);
  assert.equal(await page.locator(".sentence").count(), 4);
  assert.match(await page.locator(".notice").textContent(), /4개 생략/);
  await send({ type: "caption", caption: { ...base, utteranceId: "burst-4", revision: 99, translation: "부활 응답" } });
  assert.doesNotMatch(await cue.textContent(), /부활/);
  assert.equal(warnings.length, 4, "A discarded cue cannot re-enter the waiting list");
  await page.waitForFunction(() => document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".cue")?.textContent.includes("문장11"), null, { timeout: 7000 });
  assert.equal(await cue.textContent(), "문장8문장9문장10문장11");
  await send({ type: "start", sessionId: "replacement" });
  await send({ type: "caption", caption: { ...base, sessionId: "replacement", translation: "교체." } });
  await send({ type: "caption", caption: { ...base, revision: 99, translation: "이전 세션" } });
  assert.equal(await cue.textContent(), "교체.");
  assert.equal(await page.locator(".notice").textContent(), "");
  await send({ type: "clear", sessionId: "replacement" });
  await page.waitForTimeout(2700);
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  await send({ type: "caption", caption: { ...base, sessionId: "replacement", revision: 100 } });
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  await send({ type: "start", sessionId: base.sessionId });
  for (let i = 0; i < 8; i++) await send({ type: "caption", caption: { ...base,
    utteranceId: `budget-${i}`, translation: `구절${i}`, audioStartMs: i * 5100, audioEndMs: (i + 1) * 5100 } });
  assert.equal(warnings.length, 6, "Four waiting 5.1-second phrases must discard two to fit 12 seconds");
  assert.match(await page.locator(".notice").textContent(), /2개 생략/);
  await send({ type: "clear", sessionId: base.sessionId });
  await page.waitForTimeout(2700);
  assert.equal(await page.locator("#interpreter-captions").count(), 0, "Clear discards waiting work and its timer");
  const report = { passed: true, browser: context.browser().version(), generatedCaptions: true,
    audioTranslation: "not exercised", samples, readingTime: true, inPlaceCorrections: true, oldRevisionsRejected: true,
    expiredRevisionRejected: true, provisionalRetention: true, delayedFinalReadingTime: true, abandonedProvisionalRetired: true,
    tiedAudioTimestamps: true, resizeReadingPosition: true, correctedReadingPosition: true, rewrittenCurrentPart: true,
    finalReplay: true, finalReplayTraceVisibility: true, fadeOut: true, fadeDurationMs: 250, fullscreen: true, controls: true,
    maxLines: 4, maxWaitingCaptions: 4, maxWaitingAudioMs: 12000, overloadDropped: 4, audioBudgetDropped: 2, clear: true, replacement: true };
  await writeFile("docs/verification/captions/rolling-fixture.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  await context?.close();
  await new Promise((closed) => server.close(closed));
}
