// Settings and generated output acceptance; no audio capture or model inference.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { transformWithOxc } from "vite";

await mkdir(".ralph", { recursive: true });
await mkdir("docs/verification/settings", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/settings-browser-"));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><html lang="en"><title>Generated output fixture</title><body><button>Site control</button></body></html>');
});
await new Promise((ready) => server.listen(8766, "127.0.0.1", ready));
let context;
let companion;
try {
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  const errors = [];
  popup.on("pageerror", (error) => errors.push(error.message));
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  await popup.setViewportSize({ width: 372, height: 600 });
  await popup.goto(popupUrl);
  await popup.locator("#start:enabled").waitFor();
  assert.equal(await popup.locator('[name="sourceLanguage"]').inputValue(), "en");
  assert.equal(await popup.locator('[name="targetLanguage"]').inputValue(), "ko");
  assert.equal(await popup.locator('[name="textModel"]').inputValue(), "qwen3.5:9b");
  await popup.locator('[name="provider"]').selectOption("luna");
  await popup.locator('[name="asr"]').selectOption("openai");
  await popup.locator('[name="sourceLanguage"]').selectOption("ja");
  await popup.locator('[name="targetLanguage"]').selectOption("fr");
  await popup.waitForFunction(async () => (await chrome.storage.local.get("sessionSettings")).sessionSettings?.targetLanguage === "fr");
  await popup.reload();
  await popup.locator("#start:enabled").waitFor();
  assert.equal(await popup.locator('[name="provider"]').inputValue(), "luna");
  assert.equal(await popup.locator('[name="asrModel"]').inputValue(), "gpt-live-transcribe");
  assert.equal(await popup.locator('[name="textModel"]').inputValue(), "gpt-6-luna");
  assert.equal(await popup.locator('[name="targetLanguage"]').inputValue(), "fr");
  assert.equal(await popup.locator('[name="asrModel"]').evaluate((input) => input.readOnly), true);
  await popup.locator('[name="provider"]').selectOption("openai-direct");
  assert.equal(await popup.locator('[name="asr"]').isVisible(), false);
  assert.equal(await popup.locator('[name="textModel"]').inputValue(), "gpt-realtime-translate");
  assert.equal(await popup.locator('[name="textModel"]').evaluate((input) => input.readOnly), true);
  await popup.locator('[name="provider"]').selectOption("anthropic");
  assert.equal(await popup.locator('[name="textModel"]').inputValue(), "");
  assert.equal(await popup.locator("form").evaluate((form) => form.checkValidity()), false);
  await popup.locator('[name="textModel"]').fill("accessible-model-id");
  await popup.locator('[name="textModel"]').blur();
  assert.equal(await popup.locator("form").evaluate((form) => form.checkValidity()), true);
  await popup.waitForFunction(async () => (await chrome.storage.local.get("sessionSettings")).sessionSettings?.textModel === "accessible-model-id");
  const keys = await popup.evaluate(async () => Object.keys((await chrome.storage.local.get("sessionSettings")).sessionSettings));
  assert.deepEqual(keys.sort(), ["asr", "asrModel", "provider", "sourceLanguage", "targetLanguage", "textModel"]);
  assert.ok(await popup.locator("#stop").evaluate((button) => button.getBoundingClientRect().bottom <= innerHeight), "Popup actions must fit Chrome's 600px height limit");
  await popup.screenshot({ path: "docs/verification/settings/popup.png" });
  assert.deepEqual(errors, []);

  // A pending Start must not queue popup Stop/configuration behind model loading.
  const waitingPopup = await context.newPage();
  await waitingPopup.addInitScript(() => {
    let release;
    const idle = { state: "idle", message: "Ready" };
    const settings = { provider: "local", asr: "local", sourceLanguage: "en", targetLanguage: "ko", asrModel: "mlx-community/Qwen3-ASR-0.6B-8bit", textModel: "qwen3:4b-instruct" };
    window.preparationCommands = [];
    chrome.runtime.sendMessage = async (message) => {
      window.preparationCommands.push(message.type);
      if (message.type === "settings") return settings;
      if (message.type === "start") {
        const status = document.querySelector("#status");
        status.dataset.state = "starting";
        status.textContent = "Preparing fixture";
        document.querySelector("#stop").disabled = false;
        return new Promise((resolve) => { release = resolve; });
      }
      if (message.type === "stop" || message.type === "configure") release?.(idle);
      return idle;
    };
  });
  await waitingPopup.goto(popupUrl);
  for (const action of ["stop", "configure"]) {
    await waitingPopup.locator("#start:enabled").waitFor();
    await waitingPopup.locator("#start").click();
    await waitingPopup.locator('#status[data-state="starting"]').waitFor();
    if (action === "stop") await waitingPopup.locator("#stop").click();
    else await waitingPopup.locator('[name="sourceLanguage"]').selectOption("ja");
    await waitingPopup.locator('#status[data-state="idle"]').waitFor();
    assert.equal(await waitingPopup.evaluate(() => window.preparationCommands.at(-1)), action);
  }
  await waitingPopup.close();

  // Built offscreen sends only the selected settings and handles validation errors before capture.
  const settings = await popup.evaluate(async () => (await chrome.storage.local.get("sessionSettings")).sessionSettings);
  let requested;
  companion = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requested = { path: request.url, origin: request.headers.origin, settings: JSON.parse(body) };
    response.writeHead(422, { "Content-Type": "application/json" });
    response.end('{"detail":"fixture validation error"}');
  });
  await new Promise((ready) => companion.listen(8765, "127.0.0.1", ready));
  const rejected = await worker.evaluate(async (settings) => {
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.USER_MEDIA], justification: "Verify selected settings transport and validation cleanup without recording." });
    return chrome.runtime.sendMessage({ target: "offscreen", type: "start", tabId: 1, settings });
  }, settings);
  assert.equal(rejected.state, "error");
  assert.equal(rejected.message, "Invalid language or model selection. Check the popup settings.");
  assert.deepEqual(requested, { path: "/sessions", origin: `chrome-extension://${extensionId}`, settings });
  await popup.waitForFunction(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length === 0);
  await new Promise((closed) => companion.close(closed));
  companion = undefined;

  const page = context.pages()[0];
  await page.goto("http://127.0.0.1:8766/");
  // Exercise the actual DOM sink and a test-only memory sink in the same fan-out.
  for (const path of ["extension/captions/overlay.ts", "extension/captions/output.ts"]) {
    const source = await readFile(path, "utf8");
    const compiled = (await transformWithOxc(source, path, { target: "es2022" })).code;
    await page.addScriptTag({ content: compiled.replace(/export /g, "") });
  }
  const injection = '<img src=x onerror="window.captionInjected=true">';
  await page.evaluate((text) => {
    window.memory = [];
    const memorySink = { caption: (caption) => window.memory.push(caption), status: (message) => window.memory.push(message), clear: () => window.memory.push("clear"), dispose: () => window.memory.push("dispose") };
    window.output = createCaptionOutput("new", [createCaptionOverlay(), memorySink]);
    window.generatedCaption = { sessionId: "new", utteranceId: "u1", revision: 1, source: "Generated", translation: text, final: false, audioStartMs: 0, audioEndMs: 1, emittedAtMs: 2 };
    window.output.event({ type: "caption", caption: window.generatedCaption });
  }, injection);
  assert.equal(await page.locator("#interpreter-captions .cue").textContent(), injection);
  assert.equal(await page.locator("#interpreter-captions img").count(), 0);
  assert.equal(await page.evaluate(() => window.captionInjected), undefined);
  assert.equal(await page.evaluate(() => window.memory[0].translation), injection);
  await page.evaluate(() => {
    window.output.event({ type: "status", sessionId: "new", message: "Listening" });
    window.output.event({ type: "clear", sessionId: "old" });
    window.output.event({ type: "caption", caption: { ...window.generatedCaption, sessionId: "old", revision: 99, translation: "late" } });
  });
  assert.equal(await page.locator("#interpreter-captions .cue").textContent(), injection);
  await page.evaluate(() => window.output.event({ type: "clear", sessionId: "new" }));
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  await page.evaluate(() => {
    window.output.dispose();
    window.output.event({ type: "caption", caption: window.generatedCaption });
  });
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.memory.slice(1)), ["Listening", "clear", "dispose"]);

  // Built content-script installation/replacement must have one host and ignore old responses.
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  const send = (message) => worker.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, { target: "captions", ...message }), { id: tabId, message });
  const caption = await page.evaluate(() => window.generatedCaption);
  await send({ type: "start", sessionId: "old" });
  await send({ type: "caption", caption: { ...caption, sessionId: "old", translation: "Old generated cue" } });
  await send({ type: "start", sessionId: "new" });
  await send({ type: "caption", caption });
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  await send({ type: "caption", caption: { ...caption, sessionId: "old", revision: 99, translation: "Late result" } });
  await send({ type: "clear", sessionId: "old" });
  assert.equal(await page.locator("#interpreter-captions").count(), 1);
  assert.equal(await page.locator("#interpreter-captions .cue").textContent(), injection);
  assert.equal(await page.locator("#interpreter-captions img").count(), 0);
  await send({ type: "clear", sessionId: "new" });
  await send({ type: "caption", caption });
  assert.equal(await page.locator("#interpreter-captions").count(), 0);
  console.log(JSON.stringify({ browser: context.browser().version(), settingsPersistence: true, pendingStartInterrupted: true, offscreenSettingsTransport: true, validationCleanup: true, domMemoryFanOut: true, htmlInjectionRejected: true, replacedSessionRejected: true, singleOverlay: true, audioTranslation: "not exercised", passed: true }));
} finally {
  await context?.close();
  if (companion) await new Promise((closed) => companion.close(closed));
  await new Promise((closed) => server.close(closed));
}
