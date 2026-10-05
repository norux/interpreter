// Generated captions exercise the built sink, not capture or translation.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const youtube = process.argv.includes("--youtube");
await mkdir(".ralph", { recursive: true });
await mkdir("docs/verification/captions", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/captions-browser-"));
const fixture = await readFile("tests/fixtures/captions.html");
const server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(fixture); });
await new Promise((ready) => server.listen(8766, "127.0.0.1", ready));
let context;
try {
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: !youtube, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = context.pages()[0];
  await page.goto(youtube ? "https://www.youtube.com/watch?v=jNQXAC9IVRw" : "http://127.0.0.1:8766/captions.html");
  if (youtube) {
    console.log("READY: use the actual Extensions toolbar → Interpreter to grant activeTab, then press Enter here. Do not Start audio capture.");
    const input = createInterface({ input: process.stdin, output: process.stdout });
    await input.question("");
    input.close();
  }
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  assert.ok(tabId);
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  async function send(message) {
    await worker.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, { target: "captions", ...message }), { id: tabId, message });
  }
  const caption = {
    sessionId: "generated-test", utteranceId: "one", revision: 1, source: "Generated test caption.",
    translation: "이 자막은 화면 아래에 두 줄까지 표시됩니다. 영상 컨트롤은 그대로 누를 수 있습니다.",
    final: false, audioStartMs: 0, audioEndMs: 1000, emittedAtMs: Date.now(),
  };
  const cue = page.locator("#interpreter-captions .cue");
  await send({ type: "start", sessionId: caption.sessionId });
  await send({ type: "caption", caption });
  await cue.waitFor();
  async function inspect(name) {
    await page.evaluate(() => new Promise((ready) => requestAnimationFrame(() => requestAnimationFrame(ready))));
    const result = await cue.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const host = element.getRootNode().host;
      return { text: element.textContent, height: element.clientHeight, lineHeight: Number.parseFloat(style.lineHeight),
        color: style.color, pointerEvents: getComputedStyle(host).pointerEvents,
        left: box.left, right: box.right, bottom: box.bottom, width: innerWidth, viewportHeight: innerHeight,
        fullscreen: document.fullscreenElement !== null, insideFullscreen: document.fullscreenElement?.contains(host) ?? false,
        controlTop: document.querySelector(".ytp-chrome-bottom")?.getBoundingClientRect().top };
    });
    assert.ok(result.height <= result.lineHeight * 2 + 9, `${name}: more than two lines`);
    assert.equal(result.color, "rgb(255, 255, 255)");
    assert.equal(result.pointerEvents, "none");
    assert.ok(result.left >= result.width * 0.09 && result.right <= result.width * 0.91);
    assert.ok(result.bottom < result.viewportHeight - 60);
    if (name.startsWith("youtube-")) assert.ok(result.bottom < result.controlTop - 10, "YouTube captions must sit above video controls");
    await page.screenshot({ path: `docs/verification/captions/${name}.png`, animations: "disabled" });
    console.log(JSON.stringify({ name, ...result }));
  }
  await inspect(youtube ? "youtube-normal" : "normal");
  await send({ type: "caption", caption: { ...caption, revision: 2, translation: "같은 구절의 수정은 기존 자막을 교체합니다." } });
  await send({ type: "caption", caption });
  assert.equal(await cue.textContent(), "같은 구절의 수정은 기존 자막을 교체합니다.");
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  assert.equal(await page.locator("#interpreter-captions").count(), 1);
  if (!youtube) {
    await page.locator("#play").click();
    assert.equal(await page.locator("#play").textContent(), "Clicked");
    await page.locator("input").click();
    await page.setViewportSize({ width: 390, height: 700 });
    await send({ type: "caption", caption: { ...caption, revision: 3 } });
    await inspect("narrow");
    const long = "긴 문장을 잘라 숨기지 않고 모든 내용을 차례대로 보여줍니다. ".repeat(5);
    await send({ type: "caption", caption: { ...caption, revision: 4, translation: long, final: true } });
    let displayed = "";
    let previous = "";
    while (await page.locator("#interpreter-captions").count()) {
      const text = await cue.textContent();
      if (text !== previous) { displayed += text; previous = text; }
      assert.ok(await cue.evaluate((element) => element.clientHeight <= Number.parseFloat(getComputedStyle(element).lineHeight) * 2 + 9));
      await page.waitForTimeout(100);
    }
    assert.equal(displayed, long.trim(), "Every character of a long cue must appear");
    await page.setViewportSize({ width: 1280, height: 800 });
    await send({ type: "caption", caption: { ...caption, revision: 5 } });
    await page.locator("#fullscreen").click();
  } else {
    await page.locator(".ytp-size-button").click();
    await page.locator("ytd-watch-flexy[theater]").waitFor();
    await send({ type: "caption", caption: { ...caption, revision: 3 } });
    await inspect("youtube-theatre");
    await page.locator(".ytp-fullscreen-button").click();
    await send({ type: "caption", caption: { ...caption, revision: 4 } });
  }
  await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector("#interpreter-captions")));
  await inspect(youtube ? "youtube-fullscreen" : "fullscreen");
  assert.equal(await cue.evaluate((element) => document.fullscreenElement.contains(element.getRootNode().host)), true);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.fullscreenElement === null && document.querySelector("#interpreter-captions")?.parentElement === document.documentElement);
  assert.equal(await cue.evaluate((element) => element.getRootNode().host.parentElement === document.documentElement), true);
  await send({ type: "clear", sessionId: caption.sessionId });
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  await send({ type: "caption", caption: { ...caption, revision: 9 } });
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  console.log(JSON.stringify({ browser: context.browser().version(), generatedCaptions: true, audioTranslation: "not exercised", passed: true }));
} finally {
  await context?.close();
  await new Promise((closed) => server.close(closed));
}
