import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-popup-build");
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: { outDir: output } });
const server = createServer(async (request, response) => {
  const file = resolve(output, `.${new URL(request.url, "http://localhost").pathname}`);
  if (!file.startsWith(output + sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const params = new URL(location.href).searchParams;
    const fresh = params.has("fresh") || params.has("downloading");
    globalThis.commands = []; globalThis.installs = [];
    globalThis.listeners = []; globalThis.delaySnapshot = false;
    globalThis.packs = fresh ? [] : ["ja-JP", "en-US", "ko-KR"];
    globalThis.translationReady = !fresh;
    globalThis.saved = { state: "idle", source: "ja", message: "初期", captions: [] };
    if (params.has("downloading")) saved = { ...saved, state: "preparing", tabId: 10, message: "백그라운드 다운로드 중…" };
    class Speech {
      processLocally = false;
      static async available({ langs }) { return langs.every(lang => packs.includes(lang)) ? "available" : "downloadable"; }
      static async install({ langs }) { installs.push(langs); packs = [...langs]; translationReady = true; return true; }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Speech });
    if (params.has("whisper")) Speech.install = undefined;
    Object.defineProperty(window, "Translator", { configurable: true, value: { availability: async () => translationReady ? "available" : "downloadable" } });
    Object.defineProperty(window, "chrome", { configurable: true, value: {
      tabs: { query: async () => [{ id: 10, url: "http://fixture.test" }] },
      runtime: { id: "fixture", onMessage: { addListener(listener) { listeners.push(listener); }, removeListener() {} }, async sendMessage({ command }) {
        commands.push(command);
        if (command.type === "prepare") saved = { state: "ready", source: command.source, tabId: command.tabId, message: "준비 완료", captions: [] };
        if (command.type === "start") saved = { ...saved, state: "starting", message: "탭 오디오에 연결 중…" };
        if (command.type === "stop") {
          saved = { state: "idle", source: saved.source, message: "중지됨", captions: [] };
          delaySnapshot = true;
          for (const listener of listeners) listener({ channel: "interpreter-event-v1" }, { id: "fixture" });
        }
        if (command.type === "snapshot" && delaySnapshot) {
          delaySnapshot = false; const old = { ...saved };
          await new Promise(done => setTimeout(done, 100)); return { snapshot: old };
        }
        return { snapshot: { ...saved } };
      } },
    } });
  });
  const url = `http://127.0.0.1:${server.address().port}/popup.html`;
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector("#start").disabled, undefined, { timeout: 3000 });
  assert.deepEqual(await page.evaluate(() => installs), [], "Cached models must not reinstall");
  assert.equal(await page.locator("#prepare").isVisible(), false);
  assert.equal(await page.evaluate(() => commands.some(command => command.type === "start")), false, "Readiness must not capture audio");
  await page.getByRole("button", { name: "번역 시작", exact: true }).click();
  assert.equal(await page.locator("#prepare").isVisible(), false, "No disabled Prepare button while starting");
  for (const state of ["running", "failed"]) {
    await page.evaluate(state => {
      saved = { ...saved, state, message: state };
      for (const listener of listeners) listener({ channel: "interpreter-event-v1" }, { id: "fixture" });
    }, state);
    await page.waitForFunction(state => document.querySelector("#status").textContent === state, state);
    assert.equal(await page.locator("#prepare").isVisible(), false);
  }
  await page.getByRole("button", { name: "중지", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#start").disabled);
  assert.equal(await page.evaluate(() => commands.filter(command => command.type === "prepare").length), 2);
  await page.locator("#language").selectOption("en");
  await page.waitForFunction(() => saved.source === "en" && !document.querySelector("#start").disabled);
  assert.deepEqual(await page.evaluate(() => installs), []);
  await page.evaluate(() => { packs = ["ja-JP", "en-US"]; });
  await page.locator("#language").selectOption("ja");
  await page.waitForFunction(() => !document.querySelector("#prepare").disabled);
  assert.equal(await page.locator("#start").isVisible(), false, "Japanese and English cannot bypass the Korean Chrome bootstrap pack");
  await page.evaluate(() => { packs = ["ja-JP", "en-US", "ko-KR"]; });
  await page.locator("#language").selectOption("en");
  await page.waitForFunction(() => !document.querySelector("#start").disabled);
  await page.evaluate(() => { packs = ["ja-JP"]; });
  await page.locator("#language").selectOption("ja");
  await page.waitForFunction(() => !document.querySelector("#prepare").disabled);
  assert.equal(await page.locator("#start").isDisabled(), true, "Japanese alone cannot bypass the English bootstrap dependency");
  assert.deepEqual(await page.evaluate(() => installs), []);
  await page.goto(`${url}?fresh`);
  await page.waitForFunction(() => !document.querySelector("#prepare").disabled);
  assert.equal(await page.locator("#start").isVisible(), false, "Download setup must precede translation controls");
  assert.equal(await page.locator("#reference").isVisible(), false, "No record window before model setup");
  assert.match(await page.locator("#model-description").textContent(), /Chrome SODA/u);
  assert.equal(await page.locator("#start").isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => commands.filter(command => command.type === "prepare" || command.type === "start")), []);
  await page.getByRole("button", { name: "모델 다운로드", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#start").disabled);
  assert.deepEqual(await page.evaluate(() => installs), [["ja-JP", "en-US", "ko-KR"]]);
  assert.equal(await page.locator("#model-setup").isVisible(), false);
  assert.equal(await page.locator("#start").isVisible(), true);
  await page.goto(`${url}?fresh&whisper`);
  await page.waitForFunction(() => !document.querySelector("#prepare").disabled);
  assert.match(await page.locator("#model-description").textContent(), /Whisper large-v3-turbo/u);
  assert.match(await page.locator("#model-description").textContent(), /Silero VAD/u);
  assert.equal(await page.locator("#start").isVisible(), false);
  await page.getByRole("button", { name: "모델 다운로드", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#start").disabled);
  assert.deepEqual(await page.evaluate(() => installs), [], "Whisper setup must not call unsupported native speech installation");
  await page.goto(`${url}?downloading`);
  await page.getByText("백그라운드 다운로드 중…", { exact: true }).waitFor();
  assert.equal(await page.locator("#start").isVisible(), false);
  assert.equal(await page.locator("#prepare").isVisible(), true);
  assert.equal(await page.locator("#prepare").isDisabled(), true);
  assert.equal(await page.evaluate(() => commands.some(command => command.type === "prepare")), false, "Reopening must observe, not restart, the background download");
  await page.evaluate(() => {
    saved = { ...saved, state: "ready", message: "준비 완료" };
    for (const listener of listeners) listener({ channel: "interpreter-event-v1" }, { id: "fixture" });
  });
  await page.waitForFunction(() => !document.querySelector("#start").disabled);
  assert.equal(await page.locator("#model-setup").isVisible(), false);
  assert.equal(await page.locator("#start").isVisible(), true);
  console.log(JSON.stringify({ passed: true, scope: "Popup DOM and browser API mocks; cached models auto-ready on open/Stop, missing packs require a download gesture, readiness never starts capture" }));
} finally {
  await browser?.close(); await new Promise(done => server.close(done));
}
