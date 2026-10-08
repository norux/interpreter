import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-translation-build");
const fixtures = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8")).clips;
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: { translator: resolve("packages/engines-browser/document-translator.ts"), queue: resolve("packages/engines-browser/translation-queue.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare">Prepare selected language</button><button id="stop">Stop</button><script type="module">
      import {createDocumentTranslator} from '/translator.js';
      import {createTranslationQueue} from '/queue.js';
      globalThis.statuses = []; globalThis.captions = []; globalThis.failures = [];
      const language = new URL(location.href).searchParams.get('language');
      globalThis.host = createDocumentTranslator(document, {source: language, target: 'ko'}, status => statuses.push(status));
      globalThis.queue = createTranslationQueue({sessionId: 'translation-fixture', targetId: 'video', epoch: 1},
        {source: language, target: 'ko'}, host, 4, 300, caption => captions.push(caption), reason => failures.push(reason));
      globalThis.withoutActivation = host.prepare().then(() => 'unexpected', error => error.message);
      document.querySelector('#prepare').onclick = () => {
        globalThis.prepared = false; globalThis.failure = undefined;
        host.prepare().then(() => {globalThis.prepared = true}, error => {globalThis.failure = {name: error.name, message: error.message}});
      };
      document.querySelector('#stop').onclick = () => {queue.cancel(); host.stop()};
      globalThis.submit = (text, revision, final) => queue.accept({identity: {sessionId: 'translation-fixture', targetId: 'video', epoch: 1},
        utteranceId: 'speech', sourceRevision: revision, text, final, language, audioRange: {startMs: 0, endMs: 7000}});
      globalThis.loaded = true;
    </script>`);
    return;
  }
  const file = resolve(output, `.${path}`);
  if (!file.startsWith(output + sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".mjs": "text/javascript" })[extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const observations = { scope: "B3 native document translation of labeled synthetic text and revision queue; no PCM, ASR or application DOM accuracy", runs: [], pageErrors: [] };
let browser; let browserProcess; let browserExit; let profile;
const failures = [];
try {
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-translation-profile-"));
  // CfT disables background component updates. Register only the required
  // native components in this owned profile; Chrome downloads and verifies them.
  const components = ["Chrome TranslateKit", "Chrome TranslateKit en-ja", "Chrome TranslateKit en-ko"];
  await writeFile(resolve(profile, "Local State"), JSON.stringify({ on_device_translation: {
    translate_kit_registered: true, translate_kit_packages: { en_ja_registered: true, en_ko_registered: true },
  } }));
  const configuration = resolve(profile, "cft-config.json");
  await writeFile(configuration, JSON.stringify({ requiredComponents: components,
    requiredComponentsDir: resolve(".ralph/media-framework/chrome-translation-components"), requiredComponentsUpdateTimeout: "120s" }));
  observations.requiredComponents = components;
  browserProcess = spawn(chromium.executablePath(), ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
    `--chrome-for-testing-config=${configuration}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  browserExit = new Promise(done => { browserProcess.once("exit", done); browserProcess.once("error", done); });
  let port; const deadline = performance.now() + 120000;
  while (performance.now() < deadline && browserProcess.exitCode === null) {
    try { port = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert.ok(port, "Owned Chromium must expose its debugging endpoint");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  observations.browser = browser.version(); observations.platform = `${process.platform}/${process.arch}`;
  // The debugging endpoint may precede the first document while CfT downloads.
  let page;
  while (performance.now() < deadline && browserProcess.exitCode === null) {
    page = browser.contexts()[0]?.pages()[0];
    if (page) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(page, "Owned Chromium must finish required native component preparation");
  page.on("pageerror", error => observations.pageErrors.push(error.message));
  for (const fixture of fixtures) {
    const run = { language: fixture.language, target: "ko", checks: [] }; observations.runs.push(run);
    await page.goto(`${origin}/?language=${fixture.language}`); await page.waitForFunction(() => globalThis.loaded);
    run.context = await page.evaluate(() => ({ visible: document.visibilityState, secure: isSecureContext, api: typeof Translator }));
    assert.equal(run.context.visible, "visible"); assert.equal(run.context.secure, true);
    assert.match(await page.evaluate(() => withoutActivation), /Press Prepare/);
    run.capability = await page.evaluate(() => host.probe());
    if (!["available", "download-required"].includes(run.capability.state)) {
      failures.push(`${fixture.language}: ${run.capability.reason}`); console.log(JSON.stringify({ run })); continue;
    }
    const started = performance.now();
    // One real gesture per selected language: creation may consume activation.
    await page.locator("#prepare").click();
    try { await page.waitForFunction(() => prepared || failure, undefined, { timeout: 120000, polling: 100 }); }
    catch (error) { run.timeout = error.message; }
    run.preparationMs = performance.now() - started;
    run.preparation = await page.evaluate(() => ({ ready: prepared, failure, statuses }));
    if (!run.preparation.ready) {
      await page.locator("#stop").click();
      run.afterStop = await page.evaluate(() => statuses.at(-1));
      failures.push(`${fixture.language}: ${run.preparation.failure?.message ?? run.timeout}`);
      console.log(JSON.stringify({ run })); continue;
    }
    run.checks.push("Real native pair creation from trusted document activation");
    await page.evaluate(text => { submit(text, 1, false); submit(text, 2, true); }, fixture.text);
    await page.waitForFunction(() => captions.some(c => c.source.sourceRevision === 2 && c.translation.state === 'paired') || failures.length, undefined, { timeout: 30000 });
    run.captions = await page.evaluate(() => captions); run.failures = await page.evaluate(() => failures);
    assert.deepEqual(run.failures, []);
    assert.equal(run.captions[0].translation.state, "pending");
    const finalSourceIndex = run.captions.findIndex(c => c.source.sourceRevision === 2);
    assert.equal(run.captions[finalSourceIndex].translation.state, "pending");
    const result = run.captions.at(-1); const translated = result.translation.revision;
    assert.equal(result.source.sourceRevision, 2); assert.equal(result.source.final, true);
    assert.equal(translated.sourceRevision, 2); assert.equal(translated.final, true);
    assert.deepEqual(translated.identity, result.source.identity); assert.equal(translated.utteranceId, result.source.utteranceId);
    assert.deepEqual(translated.languages, { source: fixture.language, target: "ko" }); assert.match(translated.text, /[가-힣]/u);
    assert.ok(run.captions.every(c => c.translation.state !== "paired" || c.source.sourceRevision === c.translation.revision.sourceRevision));
    run.checks.push("Real Korean output, original-before-translation, latest final revision pairing");
    await page.locator("#stop").click();
    assert.equal(await page.evaluate(text => submit(text, 3, true), fixture.text), false);
    const count = await page.evaluate(() => captions.length); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => captions.length), count);
    await page.evaluate(() => host.close());
    run.checks.push("Stop suppresses further submissions and captions");
    console.log(JSON.stringify({ run }));
  }
  assert.deepEqual(observations.pageErrors, []);
  assert.deepEqual(failures, [], "Both real language pairs must prepare and translate; capability/model loading alone cannot pass");
  console.log(JSON.stringify({ passed: true, ...observations }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, ...observations, failures, error: error.message }));
  process.exitCode = 1;
} finally {
  browserProcess?.kill("SIGTERM"); await browser?.close(); await browserExit;
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
