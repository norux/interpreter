// Built comparison UI and runtime contract with generated pairs; no live audio/models.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve("extension/dist");
const server = createServer(async (request, response) => {
  const path = resolve(root, `.${new URL(request.url, "http://localhost").pathname}`);
  try {
    if (!path.startsWith(`${root}${sep}`)) throw new Error("Outside fixture root");
    const content = await readFile(path);
    response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html");
    response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-06T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-06T00:00:01Z"));
  await page.addInitScript(() => {
    globalThis.chrome = { runtime: {
      id: "comparison-fixture", getURL: (path) => `chrome-extension://comparison-fixture/${path}`,
      onMessage: { addListener: (callback) => { globalThis.receiveTranscript = callback; } },
      sendMessage: async () => ({ target: "transcript", type: "snapshot", sessionId: "one", captions: [], dropped: 0, status: { state: "capturing", message: "Listening" } }),
    } };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/transcript.html`);
  await page.locator('#status[data-state="capturing"]').waitFor();
  const base = { sessionId: "one", utteranceId: "u1", revision: 1, source: "今日は晴れています。", translation: "오늘은 맑습니다.", final: false, audioStartMs: 1250, audioEndMs: 9850, emittedAtMs: 1 };
  const send = (message, sender = "service-worker.js") => page.evaluate(({ message, sender }) => {
    globalThis.receiveTranscript({ target: "transcript", ...message }, { id: "comparison-fixture", url: chrome.runtime.getURL(sender) });
  }, { message, sender });
  await send({ type: "caption", caption: base, dropped: 0 });
  const row = page.locator("#sentences tr");
  assert.equal(await row.locator(".source").textContent(), base.source);
  assert.equal(await row.locator(".translation").textContent(), base.translation);
  assert.match(await row.locator(".time").textContent(), /00:01\.250— 00:09\.850/);
  const boxes = await row.locator("td").evaluateAll((cells) => cells.map((cell) => ({ left: cell.getBoundingClientRect().left, right: cell.getBoundingClientRect().right })));
  assert.ok(boxes[0].right <= boxes[1].left && boxes[1].right <= boxes[2].left, "Source, time and translation must form ordered separate columns");
  await row.evaluate((node) => { globalThis.originalRow = node; });
  for (let i = 1; i <= 12; i++) {
    await page.clock.runFor(20);
    await send({ type: "caption", caption: { ...base, revision: i + 1, source: `原文 ${i}`, translation: `번역 ${i}` }, dropped: 0 });
  }
  assert.equal(await row.locator(".source").textContent(), base.source, "Source corrections are paced together with translation");
  assert.equal(await row.locator(".translation").textContent(), base.translation);
  await page.clock.runFor(760);
  assert.equal(await row.locator(".source").textContent(), "原文 12");
  assert.equal(await row.locator(".translation").textContent(), "번역 12");
  assert.equal(await row.evaluate((node) => node === globalThis.originalRow), true);
  await send({ type: "caption", caption: { ...base, revision: 14, source: "대기 원문", translation: "대기 번역" }, dropped: 0 });
  const final = { ...base, revision: 15, final: true, source: "<img src=x onerror=alert(1)>\n日本語の長い文です。".repeat(8), translation: "긴 문장의 최종 번역입니다. 줄을 나누어 전체 내용을 보여줍니다. ".repeat(8) };
  await send({ type: "caption", caption: final, dropped: 0 });
  assert.equal(await row.locator(".source").textContent(), final.source);
  assert.equal(await row.locator(".translation").textContent(), final.translation);
  assert.equal(await row.locator("img").count(), 0, "Recognized source is plain text");
  await page.clock.runFor(1000);
  assert.equal(await row.locator(".translation").textContent(), final.translation);
  await send({ type: "caption", caption: { ...base, revision: 16, translation: "외부 메시지" }, dropped: 0 }, "offscreen.html");
  await send({ type: "caption", caption: { ...base, sessionId: "old", revision: 16 }, dropped: 0 });
  assert.equal(await row.locator(".translation").textContent(), final.translation);
  await send({ type: "status", status: { state: "idle", message: "Stopped" } });
  await page.clock.runFor(10000);
  assert.equal(await row.count(), 1, "Stop retains the comparison without subtitle expiry");
  await mkdir("docs/verification/transcript", { recursive: true });
  await page.screenshot({ path: "docs/verification/transcript/normal.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "docs/verification/transcript/dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 700 });
  assert.ok(await page.locator(".comparison").evaluate((element) => element.scrollWidth > element.clientWidth), "Narrow windows keep separate columns with horizontal scrolling");
  assert.ok(await page.locator(".time span:not(.phase)").evaluateAll((spans) => spans.every((span) => span.clientHeight <= Number.parseFloat(getComputedStyle(span).lineHeight) + 1)), "Time values must stay on one line in narrow windows");
  await page.screenshot({ path: "docs/verification/transcript/narrow.png", fullPage: true });
  await send({ type: "caption", caption: { ...base, utteranceId: "next", final: true }, dropped: 1, removedId: "u1" });
  assert.equal(await row.count(), 1);
  assert.equal(await row.getAttribute("data-utterance-id"), "next");
  assert.match(await page.locator("#retention").textContent(), /이전 1개/);
  await send({ type: "caption", caption: { ...base, utteranceId: "next", revision: 2, final: false }, dropped: 1 });
  await send({ type: "snapshot", sessionId: "replacement", captions: [], dropped: 0 });
  await page.clock.runFor(1500);
  assert.equal(await row.count(), 0, "New sessions clear rows and delayed corrections");
  await send({ type: "snapshot", sessionId: "replacement", captions: [{ ...base, sessionId: "replacement", final: true }], dropped: 0 });
  assert.equal(await row.locator(".source").textContent(), base.source, "Reopen snapshots restore both sides");
  assert.deepEqual(errors, []);
  await send({ type: "snapshot", sessionId: "preview", captions: [
    { ...base, sessionId: "preview", final: true, audioStartMs: 0, audioEndMs: 12000, source: "雨は正午前にやむので、旅行は中止しません。青い傘を持って、午後三時に駅で会いましょう。", translation: "비가 정오 전에 그치므로 여행을 취소하지 않습니다. 파란 우산을 들고 오후 3시에 역에서 만나요." },
    { ...base, sessionId: "preview", utteranceId: "u2", final: true, audioStartMs: 13050, audioEndMs: 18200, source: "電車は午前十二時ではなく、午後十二時に出発します。", translation: "전차는 오전 12시가 아니라 오후 12시에 출발합니다." },
  ], dropped: 0 });
  await send({ type: "status", status: { state: "capturing", message: "Generated preview" } });
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: "docs/verification/transcript/preview.png", fullPage: true });
  await writeFile("docs/verification/transcript/ui.json", `${JSON.stringify({ browser: browser.version(), generatedPairs: true, realCapture: false, columns: true, audioTime: true, correctionIntervalMs: 1000, sameRow: true, immediateFinal: true, plainSource: true, stopRetention: true, eviction: true, sessionReplacement: true, replay: true, normalDarkNarrow: true, pageErrors: errors }, null, 2)}\n`);
  console.log("Transcript comparison checks passed");
} finally { await browser.close(); await new Promise((closed) => server.close(closed)); }
