// Real production tab action/input → unchanged smallFp16/WebGPU → native Korean → DOM.
// Functional B5a coverage only; strict B6 accuracy/latency/long-run gates stay separate.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const captureLoss = process.argv.includes("--capture-loss");
const output = resolve(".ralph/media-framework/chrome-tab-engine-build");
const fixtures = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8")).clips;
const media = new Map();
for (const fixture of fixtures) {
  const bytes = await readFile(`tests/fixtures/video-speech/${fixture.language}.webm`);
  assert.equal(bytes.length, fixture.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
  media.set(`/${fixture.language}.webm`, bytes);
}
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: { outDir: output } });
if (captureLoss) await build({ configFile: false, root: resolve("tests/fixtures/tab-capture"), logLevel: "warn", build: {
  outDir: output, emptyOutDir: false, rollupOptions: { input: { observer: resolve("tests/fixtures/tab-capture/output.html") }, output: { entryFileNames: "[name].js" } },
} });
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, "utf8"));
assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "tabCapture"]);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.action.default_popup, undefined);
const observations = { scope: "B5a real production tab PCM/ASR/native Korean/comparison/page DOM and active cancellation; no B6 accuracy/latency/ten-minute acceptance",
  pageErrors: [], checks: [], runs: [], companionEndpoints: [], modelRequests: [] };
function serve(request, response) {
  const url = new URL(request.url, "http://localhost");
  const bytes = media.get(url.pathname);
  if (bytes) {
    response.setHeader("Content-Type", "video/webm"); response.setHeader("Accept-Ranges", "bytes");
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end) { response.writeHead(416); response.end(); return; }
    if (range) { response.statusCode = 206; response.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`); }
    response.setHeader("Content-Length", end - start + 1); response.end(bytes.subarray(start, end + 1)); return;
  }
  response.setHeader("Content-Type", "text/html");
  const language = url.searchParams.get("language") === "en" ? "en" : "ja";
  const mode = url.searchParams.get("mode") ?? "video";
  if (mode === "iframe") {
    response.end(`<!doctype html><title>Cross-origin tab speech</title><iframe src="http://localhost:${server.address().port}/?mode=video&language=${language}"></iframe>`); return;
  }
  response.end(`<!doctype html><meta charset="utf-8"><title>Tab speech fixture</title>
    ${mode === "web-audio" ? "" : `<${mode === "audio" ? "audio" : "video"} id="media" src="/${language}.webm" controls preload="auto" loop></${mode === "audio" ? "audio" : "video"}>`}
    <button id="play">Play speech</button><script>
    play.onclick=async()=>{
      ${mode === "web-audio" ? `
      if(!globalThis.audio){globalThis.audio=new AudioContext();globalThis.buffer=await audio.decodeAudioData(await (await fetch('/${language}.webm')).arrayBuffer());}
      if(globalThis.speech)speech.stop();globalThis.speech=audio.createBufferSource();speech.buffer=buffer;speech.loop=true;speech.connect(audio.destination);speech.start();await audio.resume();`
      : "media.currentTime=0;await media.play();"}
    };
    </script>`);
}
const server = createServer(serve);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browserProcess; let browserExit; let browser; let profile; let host;
try {
  for (const port of [8765, 11434]) {
    const result = await new Promise(done => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); done("listening"); });
      socket.once("error", error => done(error.code));
      socket.setTimeout(1000, () => { socket.destroy(); done("timeout"); });
    });
    observations.companionEndpoints.push({ port, result });
    assert.equal(result, "ECONNREFUSED", "Companion/Ollama must be absent; never stop user apps");
  }
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-tab-engine-profile-"));
  // Existing explicitly prepared CfT native components, in this disposable test
  // profile only. Chrome downloads/verifies them; no Translator results are injected.
  const components = ["Chrome TranslateKit", "Chrome TranslateKit en-ja", "Chrome TranslateKit en-ko"];
  await writeFile(resolve(profile, "Local State"), JSON.stringify({ on_device_translation: {
    translate_kit_registered: true, translate_kit_packages: { en_ja_registered: true, en_ko_registered: true },
  } }));
  const configuration = resolve(profile, "cft-config.json");
  await writeFile(configuration, JSON.stringify({ requiredComponents: components,
    requiredComponentsDir: resolve(".ralph/media-framework/chrome-translation-components"), requiredComponentsUpdateTimeout: "120s" }));
  observations.requiredComponents = components;
  browserProcess = spawn(chromium.executablePath(), ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
    `--chrome-for-testing-config=${configuration}`, "--enable-unsafe-extension-debugging", "--remote-debugging-port=0",
    "--window-position=0,30", "--window-size=700,700",
    ...(captureLoss ? ['--auto-select-tab-capture-source-by-title=Output under test', '--enable-usermedia-screen-capturing'] : []), "about:blank"], { stdio: "ignore" });
  browserExit = new Promise(done => {
    browserProcess.once("exit", (code, signal) => { observations.browserExit = { code, signal }; done(); });
    browserProcess.once("error", error => { observations.browserExit = { error: error.message }; done(); });
  });
  const deadline = performance.now() + 120000;
  let port;
  while (performance.now() < deadline && browserProcess.exitCode === null) {
    try { port = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert.ok(port, "Owned Chromium must expose its debugging endpoint");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true, timeout: 120000 });
  observations.browser = browser.version(); observations.platform = `${process.platform}/${process.arch}`;
  const context = browser.contexts()[0];
  let page;
  while (performance.now() < deadline && browserProcess.exitCode === null) {
    page = context.pages()[0]; if (page) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(page, "Owned Chromium must finish native component preparation");
  const cdp = await browser.newBrowserCDPSession();
  const { id: extensionId } = await cdp.send("Extensions.loadUnpacked", { path: output });
  const matches = worker => new URL(worker.url()).host === extensionId;
  const worker = context.serviceWorkers().find(matches) ?? await context.waitForEvent("serviceworker", { predicate: matches, timeout: 15000 });
  const network = [];
  context.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) network.push(url.origin + url.pathname);
    if (url.protocol === "https:" && !observations.modelRequests.includes(url.origin + url.pathname)) observations.modelRequests.push(url.origin + url.pathname);
  });
  await context.addInitScript(() => {
    globalThis.captureObservations = [];
    if (globalThis.chrome?.tabCapture) chrome.tabCapture.onStatusChanged.addListener(info => captureObservations.push({ type: 'status', ...info }));
    if (navigator.mediaDevices) {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await getUserMedia(...args);
        stream.addEventListener('inactive', event => captureObservations.push({ type: 'inactive', trusted: event.isTrusted, active: stream.active, at: performance.now() }));
        for (const track of stream.getTracks()) track.addEventListener('ended', event => {
          captureObservations.push({ type: 'ended', trusted: event.isTrusted, state: track.readyState, active: stream.active, at: performance.now() });
        });
        return stream;
      };
    }
    globalThis.overlayTexts = [];
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        const node = document.querySelector('[data-interpreter-overlay]');
        if (!node || node.observed) return;
        node.observed = true;
        const read = () => {
          const text = node.shadowRoot.querySelector('.interpreter-live span')?.textContent;
          if (text && overlayTexts.at(-1) !== text) overlayTexts.push(text);
        };
        new MutationObserver(read).observe(node.shadowRoot, { subtree: true, childList: true, characterData: true }); read();
      }).observe(document.documentElement, { subtree: true, childList: true });
    }, { once: true });
    // Observe original worker messages and native calls without substituting
    // engines, text, PCM, timings or readiness. No audio buffers are retained.
    globalThis.engineObservations = []; globalThis.translationObservations = [];
    const NativeWorker = Worker;
    let workerId = 0;
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); this.observedId = ++workerId; let state;
        this.addEventListener("message", ({ data }) => {
          if (data?.type === "status" && data.status?.state === state) return;
          if (data?.type === "status") state = data.status?.state;
          if (["ready", "status", "error"].includes(data?.type)) engineObservations.push({ workerId: this.observedId, at: performance.now(), type: data.type, status: data.status, reason: data.reason });
          if (data?.type === "result" && typeof data.text === "string") engineObservations.push({ type: "asr-result", workerId: this.observedId, requestId: data.requestId, at: performance.now(), text: data.text, inferenceMs: data.inferenceMs });
        });
      }
      postMessage(message, ...args) {
        if (message.type === "prepare") engineObservations.push({ type: "prepare", candidate: message.candidate, device: message.device });
        if (message.type === "recognize") engineObservations.push({ type: "asr-job", workerId: this.observedId, requestId: message.requestId, at: performance.now(),
          identity: { ...message.job.identity }, language: message.job.language, samples: message.job.pcm.length,
          utteranceId: message.job.utteranceId, audioRange: { ...message.job.audioRange } });
        return super.postMessage(message, ...args);
      }
      terminate() { engineObservations.push({ type: "terminated", workerId: this.observedId, at: performance.now() }); return super.terminate(); }
    };
    if (typeof Translator !== "undefined") {
      const create = Translator.create.bind(Translator);
      Translator.create = async (...args) => {
        const translator = await create(...args);
        const translate = translator.translate.bind(translator);
        translator.translate = (text, ...options) => {
          const call = { source: text, at: performance.now(), settled: false };
          translationObservations.push(call);
          const result = translate(text, ...options);
          result.then(value => { call.settled = true; call.end = performance.now(); call.text = value; },
            error => { call.settled = true; call.end = performance.now(); call.error = error.name; });
          if (globalThis.stopDuringTranslation) {
            globalThis.stopDuringTranslation = false;
            globalThis.translationStop = { at: performance.now(), settled: call.settled, rows: document.querySelector('#app tbody').innerText };
            [...document.querySelectorAll('button')].find(button => button.textContent === 'Stop interpretation').click();
          }
          return result;
        };
        return translator;
      };
    }
  });
  async function observeOutput(surface) {
    const title = await surface.title();
    await surface.evaluate(() => { document.title = 'Output under test'; });
    const observer = await context.newPage();
    observer.on('pageerror', error => observations.pageErrors.push(error.message));
    try {
      await observer.goto(`chrome-extension://${extensionId}/output.html`);
      await observer.getByRole('button').click();
      console.log(JSON.stringify({ phase: 'native-output-requested', surface: surface.url(), marker: 6500 }));
      await observer.waitForFunction(() => globalThis.outputReady || globalThis.error);
      assert.equal(await observer.evaluate(() => globalThis.error), undefined);
      const rate = await observer.evaluate(() => outputContext.sampleRate);
      const deadline = performance.now() + 5000;
      let amplitude;
      do {
        await observer.waitForTimeout(100);
        const samples = await observer.evaluate(() => measure());
        let sin = 0, cos = 0, weight = 0;
        for (let i = 0; i < samples.length; i++) {
          const taper = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (samples.length - 1));
          const phase = 2 * Math.PI * 6500 * i / rate;
          sin += samples[i] * taper * Math.sin(phase); cos += samples[i] * taper * Math.cos(phase); weight += taper;
        }
        amplitude = 2 * Math.hypot(sin, cos) / weight;
      } while (Math.abs(amplitude / 0.06 - 1) >= 0.03 && performance.now() < deadline);
      assert.ok(Math.abs(amplitude / 0.06 - 1) < 0.03, `Native output ${amplitude} must match fixture marker 0.06 within 3%`);
      return amplitude;
    } finally { await observer.close(); await surface.evaluate(title => { document.title = title; }, title); }
  }
  let interruptedHost;
  let interruption;
  const scenarios = captureLoss ? [{ language: "ja", mode: "web-audio", interrupt: true }, { language: "ja", mode: "web-audio", recover: true }] : [
    { language: "ja", mode: "video" }, { language: "en", mode: "iframe" },
    { language: "en", mode: "audio" }, { language: "ja", mode: "web-audio" },
  ];
  for (const scenario of scenarios) {
    const run = { ...scenario }; observations.runs.push(run);
    if (scenario.recover) await context.setOffline(true);
    page.on("pageerror", error => observations.pageErrors.push(error.message));
    if (!scenario.recover) await page.goto(`${origin}/?mode=${scenario.mode}&language=${scenario.language}`);
    const source = scenario.mode === "iframe" ? page.frameLocator("iframe") : page;
    if (scenario.mode !== "web-audio") await source.locator("video,audio").evaluate(element => new Promise(done => {
      if (element.readyState >= 2) done(); else element.addEventListener("loadeddata", done, { once: true });
    }));
    await page.bringToFront();
    const tab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
    const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] });
    const target = targetInfos.find(info => info.url === page.url()); assert.ok(target);
    const opened = context.waitForEvent("page", { timeout: 15000 });
    await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
    host = await opened; host.on("pageerror", error => observations.pageErrors.push(error.message));
    await host.waitForURL(`chrome-extension://${extensionId}/tab-host.html?tab=${tab.id}`);
    await worker.evaluate(async tab => { await chrome.windows.update(tab.windowId, { left: 0, top: 30, width: 700, height: 700 }); }, tab);
    await host.evaluate(async () => { const current = await chrome.windows.getCurrent(); await chrome.windows.update(current.id, { left: 710, top: 30, width: 700, height: 700 }); });
    await host.waitForFunction(() => document.querySelector('#connection').textContent.startsWith('Capturing all audio') || document.querySelector('#connection').textContent.startsWith('Tab capture unavailable'));
    assert.match(await host.locator('#connection').textContent(), /^Capturing all audio/);
    if (scenario.language !== "ja") {
      await host.locator("#language").selectOption(scenario.language);
      await host.waitForFunction(() => document.querySelector('#connection').textContent.startsWith('Capturing all audio') && !document.querySelector('#language').disabled);
    }
    await host.waitForFunction(() => document.querySelector('#overlay-status').textContent.startsWith('Page captions available'));
    assert.equal(await host.locator("#video,#confirm").count(), 0);
    assert.equal(await host.locator("#app th").nth(1).textContent(), "Capture elapsed");
    run.context = await host.evaluate(async () => ({ visible: document.visibilityState, secure: isSecureContext, gpu: !!navigator.gpu,
      translator: typeof Translator, availability: typeof Translator === "undefined" ? null : await Translator.availability({ sourceLanguage: document.querySelector('#language').value, targetLanguage: 'ko' }) }));
    assert.equal(run.context.visible, "visible"); assert.equal(run.context.secure, true);
    assert.equal(run.context.gpu, true); assert.equal(run.context.translator, "function");
    await host.evaluate(() => {
      globalThis.rowObservations = [];
      const read = () => {
        const rows = [...document.querySelectorAll('#app tbody tr')].map(row => ({ utterance: row.dataset.utteranceId, sourceRevision: row.dataset.sourceRevision,
          translationRevision: row.dataset.translationRevision, state: row.dataset.translationState, sourceFinal: row.dataset.sourceFinal, translationFinal: row.dataset.translationFinal,
          source: row.cells[0].textContent, time: row.cells[1].textContent, korean: row.cells[2].textContent }));
        const value = JSON.stringify(rows);
        if (rows.length && rowObservations.at(-1)?.value !== value) rowObservations.push({ at: performance.now(), value, rows });
      };
      new MutationObserver(read).observe(document.querySelector('#app tbody'), { subtree: true, childList: true, characterData: true, attributes: true });
    });
    const prepare = host.getByRole("button", { name: "Prepare selected language", exact: true });
    const start = host.getByRole("button", { name: "Start interpretation", exact: true });
    const stop = host.getByRole("button", { name: "Stop interpretation", exact: true });
    await host.bringToFront();
    await host.waitForFunction(() => document.visibilityState === "visible");
    const began = performance.now(); await prepare.click();
    await host.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Start interpretation').disabled || document.querySelector('#app').textContent.includes('Preparation failed:') || document.querySelector('#connection').textContent.startsWith('Stopped.'), undefined, { timeout: 240000, polling: 100 });
    run.preparationMs = performance.now() - began; run.preparation = await host.locator("#app > section").first().innerText();
    assert.equal(await start.isEnabled(), true, run.preparation);
    console.log(JSON.stringify({ phase: "prepared", language: scenario.language, mode: scenario.mode, preparationMs: run.preparationMs }));
    await source.getByRole("button", { name: "Play speech", exact: true }).click();
    await host.bringToFront();
    await start.click();
    await host.waitForFunction(() => rowObservations.some(event => event.rows.some(row => row.state === 'paired' && row.sourceFinal === 'true' && row.translationFinal === 'true')), undefined, { timeout: 40000 });
    await page.waitForFunction(() => overlayTexts.some(text => /[가-힣]/u.test(text)), undefined, { timeout: 10000 });
    run.rows = await host.evaluate(() => rowObservations); run.engine = await host.evaluate(() => engineObservations);
    run.translations = await host.evaluate(() => translationObservations); run.overlayTexts = await page.evaluate(() => overlayTexts);
    const final = run.rows.flatMap(event => event.rows).find(row => row.state === 'paired' && row.sourceFinal === 'true' && row.translationFinal === 'true');
    const job = run.engine.find(event => event.type === 'asr-job' && event.utteranceId === final.utterance);
    const result = run.engine.find(event => event.type === 'asr-result' && event.workerId === job?.workerId && event.requestId === job?.requestId);
    assert.ok(job && result); assert.equal(job.language, scenario.language); assert.ok(job.samples > 0);
    assert.ok(job.identity.targetId.startsWith(`tab-${tab.id}-`), 'ASR must remain bound to the original captured tab');
    assert.equal(job.samples, (job.audioRange.endMs - job.audioRange.startMs) * 16);
    assert.equal(final.source, result.text); assert.equal(final.sourceRevision, "1");
    assert.match(final.source, scenario.language === 'ja' ? /[\p{Script=Hiragana}\p{Script=Han}]/u : /[a-z]/iu);
    assert.match(final.korean, /[가-힣]/u);
    assert.equal(final.time, `${(job.audioRange.startMs / 1000).toFixed(1)}–${(job.audioRange.endMs / 1000).toFixed(1)} s`);
    const pending = run.rows.findIndex(event => event.rows.some(row => row.utterance === final.utterance && row.state === 'pending'));
    const paired = run.rows.findIndex(event => event.rows.some(row => row.utterance === final.utterance && row.state === 'paired'));
    assert.ok(pending >= 0 && pending < paired, "Original ASR must paint before native Korean translation");
    const nativeCalls = run.translations.filter(call => call.at >= result.at && call.end <= run.rows[paired].at);
    assert.ok(nativeCalls.length > 0 && nativeCalls.every(call => call.settled && typeof call.text === 'string'));
    // The production Japanese adapter translates sentence phrases separately.
    // Verify every observed phrase belongs to this exact source, in order, and
    // that the DOM contains their exact combined native result.
    assert.equal(nativeCalls.map(call => call.source).join('').replace(/\s/gu, ''), final.source.replace(/\s/gu, ''));
    assert.equal(nativeCalls.map(call => call.text).join(' '), final.korean);
    assert.ok(run.overlayTexts.some(text => final.korean.trim().startsWith(text.trim()) && /[가-힣]/u.test(text)));
    assert.ok(run.engine.some(event => event.type === 'prepare' && event.candidate === 'smallFp16' && event.device === 'webgpu'));
    assert.ok(run.engine.some(event => event.type === 'status' && event.status.model.id === 'onnx-community/whisper-small' && event.status.state === 'ready' && event.status.requiredBytes === 487960440));
    assert.ok(run.engine.some(event => event.type === 'status' && event.status.model.id === 'onnx-community/silero-vad' && event.status.state === 'ready'));
    if (scenario.mode !== 'web-audio') {
      run.playback = await source.locator('video,audio').evaluate(element => ({ paused: element.paused, muted: element.muted, volume: element.volume, currentTime: element.currentTime }));
      assert.equal(run.playback.paused, false); assert.equal(run.playback.muted, false); assert.equal(run.playback.volume, 1);
    }
    if (scenario.mode === 'iframe') {
      assert.equal(await page.locator('video,audio').count(), 0);
      assert.equal(new URL(await source.locator('video').evaluate(element => element.ownerDocument.location.href)).origin, `http://localhost:${server.address().port}`);
    }
    if (scenario.mode === 'web-audio') assert.equal(await page.locator('video,audio').count(), 0);
    if (scenario.mode === 'audio') assert.equal(await page.locator('video').count(), 0);
    if (scenario.recover) {
      for (const model of ['onnx-community/whisper-small', 'onnx-community/silero-vad']) {
        assert.ok(run.engine.some(event => event.type === 'status' && event.status.model.id === model && event.status.state === 'cached'));
      }
      assert.equal(run.engine.some(event => event.type === 'status' && event.status.state === 'downloading'), false);
      run.nativeOutput = await observeOutput(host);
      assert.ok(Math.abs(run.nativeOutput / interruption.nativeOutput - 1) < 0.12, 'Recaptured output must preserve the original fixture amplitude within 12%');
      assert.notEqual(job.identity.sessionId, interruption.snapshot.pending[0].identity.sessionId);
      assert.notEqual(job.identity.targetId, interruption.snapshot.pending[0].identity.targetId);
      assert.ok(job.audioRange.startMs < interruption.snapshot.pending[0].audioRange.startMs, 'Fresh capture resets its elapsed timeline');
      assert.equal(await interruptedHost.locator('#app tbody').innerText(), interruption.snapshot.rows);
      assert.equal(await interruptedHost.locator('#app .interpreter-live').innerText(), '');
      assert.equal(await interruptedHost.locator('#capture').isDisabled(), true);
      assert.equal(await page.locator('video,audio').count(), 0);
      run.recovery = 'Fresh native extension action on the same unreloaded tab restores actual ASR/native Korean/DOM with fresh session/target/capture elapsed';
      await interruptedHost.close(); interruptedHost = undefined;
    }
    if (scenario.interrupt) {
      run.nativeOutput = await observeOutput(host);
      await host.waitForFunction(() => engineObservations.some(job => job.type === 'asr-job' && !engineObservations.some(result =>
        result.type === 'asr-result' && result.workerId === job.workerId && result.requestId === job.requestId)), undefined, { timeout: 30000, polling: 10 });
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      const audio = processInfo.filter(value => value.type === 'audio.mojom.AudioService');
      assert.equal(audio.length, 1, 'Signal only the audio service reported by this owned browser CDP connection');
      const ownedBrowser = processInfo.find(value => value.type === 'browser');
      assert.equal(ownedBrowser.id, browserProcess.pid);
      const parent = Number(execFileSync('ps', ['-p', String(audio[0].id), '-o', 'ppid='], { encoding: 'utf8' }).trim());
      assert.equal(parent, browserProcess.pid, 'Never signal a user browser or an unrelated audio service');
      const snapshot = await host.evaluate(() => ({ at: performance.now(), rows: document.querySelector('#app tbody').innerText,
        pending: engineObservations.filter(job => job.type === 'asr-job' && !engineObservations.some(result =>
          result.type === 'asr-result' && result.workerId === job.workerId && result.requestId === job.requestId)) }));
      assert.equal(snapshot.pending.length, 1, 'Native capture loss must interrupt one actual unfinished ASR');
      process.kill(audio[0].id, 'SIGTERM');
      await host.waitForFunction(() => document.querySelector('#connection').textContent.includes('Tab capture ended'));
      await page.locator('[data-interpreter-overlay]').waitFor({ state: 'detached' });
      await host.waitForTimeout(2000);
      const after = await host.evaluate(() => ({ engine: engineObservations, translations: translationObservations, capture: captureObservations }));
      run.interruption = { audio, parent, snapshot, ...after };
      const pendingJob = snapshot.pending[0];
      assert.ok(after.capture.some(event => event.type === 'ended' && event.trusted && event.state === 'ended'));
      assert.ok(after.capture.some(event => event.type === 'inactive' && event.trusted && !event.active));
      assert.ok(after.capture.some(event => event.type === 'status' && event.status === 'stopped' && event.tabId === tab.id));
      assert.ok(after.engine.some(event => event.type === 'terminated' && event.workerId === pendingJob.workerId));
      assert.equal(after.engine.some(event => event.type === 'asr-result' && event.workerId === pendingJob.workerId && event.requestId === pendingJob.requestId), false);
      assert.equal(after.engine.filter(event => event.type === 'terminated').length, 2);
      assert.equal(await host.locator('#app tbody').innerText(), snapshot.rows);
      assert.equal(await host.locator('#app .interpreter-live').innerText(), '');
      for (const control of [prepare, start, host.locator('#capture'), host.locator('#language')]) assert.equal(await control.isDisabled(), true);
      assert.equal(await worker.evaluate(async tabId => (await chrome.tabCapture.getCapturedTabs()).some(value => value.tabId === tabId && ['active', 'pending'].includes(value.status)), tab.id), false);
      const restoredOutput = await observeOutput(page);
      assert.ok(Math.abs(restoredOutput / run.nativeOutput - 1) < 0.12, 'Native-loss cleanup must restore site playback within 12%');
      interruption = { audio, parent, snapshot, nativeOutput: run.nativeOutput, restoredOutput, ...after }; run.interruption = interruption;
      interruptedHost = host; host = undefined;
      console.log(JSON.stringify({ run }));
      continue;
    }
    if (scenario.mode === 'video') {
      await source.locator('video').evaluate(element => { element.pause(); element.currentTime = 8; });
      await host.waitForTimeout(250);
      assert.equal(await host.locator('[aria-label="Interpreter captions"] [role="status"]').getAttribute('data-state'), 'running');
      assert.equal(await worker.evaluate(async tabId => (await chrome.tabCapture.getCapturedTabs()).some(value => value.tabId === tabId && value.status === 'active'), tab.id), true);
      await source.locator('video').evaluate(element => element.play());
      run.videoDiscontinuity = 'Pausing/seeking this element leaves the tab session/capture running';
    }
    await stop.click();
    await host.waitForFunction(() => document.querySelector('#app > section').textContent.includes('Stopped.') && !document.querySelector('#capture').disabled);
    await page.locator('[data-interpreter-overlay]').waitFor({ state: 'detached' });
    const rows = await host.locator('#app tbody').innerText();
    await host.waitForTimeout(1000);
    assert.equal(await host.locator('#app tbody').innerText(), rows);
    assert.equal(await host.locator('#app .interpreter-live').innerText(), '');
    assert.equal(await prepare.isDisabled(), true);
    assert.equal(await worker.evaluate(async tabId => (await chrome.tabCapture.getCapturedTabs()).some(value => value.tabId === tabId && ['active', 'pending'].includes(value.status)), tab.id), false);
    if (scenario.mode === 'web-audio' && !captureLoss) {
      // Caches were populated by real runs above; recapture keeps the same tab,
      // while every cancelled inference uses a fresh production session/worker.
      await context.setOffline(true);
      run.cancellations = [];
      await stop.evaluate(button => button.addEventListener('click', () => {
        globalThis.stopSnapshot = { at: performance.now(), rows: document.querySelector('#app tbody').innerText,
          pending: engineObservations.filter(job => job.type === 'asr-job' && !engineObservations.some(result =>
            result.type === 'asr-result' && result.workerId === job.workerId && result.requestId === job.requestId)) };
      }, { capture: true }));
      for (const reason of ['asr-stop', 'translation-stop', 'navigation']) {
        await host.locator('#capture').click();
        await host.waitForFunction(() => document.querySelector('#connection').textContent.startsWith('Capturing all audio') && !document.querySelector('#language').disabled);
        await host.evaluate(() => { engineObservations = []; translationObservations = []; globalThis.translationStop = undefined; });
        await prepare.click();
        await host.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Start interpretation').disabled || document.querySelector('#app').textContent.includes('Preparation failed:'), undefined, { timeout: 60000 });
        assert.equal(await start.isEnabled(), true, await host.locator('#app > section').first().innerText());
        const engine = await host.evaluate(() => engineObservations);
        for (const model of ['onnx-community/whisper-small', 'onnx-community/silero-vad']) {
          assert.ok(engine.some(event => event.type === 'status' && event.status.model.id === model && event.status.state === 'cached'));
        }
        assert.equal(engine.some(event => event.type === 'status' && event.status.state === 'downloading'), false);
        if (reason === 'translation-stop') await host.evaluate(() => { globalThis.stopDuringTranslation = true; });
        await start.click();
        let snapshot;
        if (reason === 'translation-stop') {
          await host.waitForFunction(() => globalThis.translationStop, undefined, { timeout: 40000 });
          snapshot = await host.evaluate(() => translationStop);
          assert.equal(snapshot.settled, false, 'Stop must happen after the real native translate call begins and before it settles');
        } else {
          await host.waitForFunction(() => engineObservations.some(job => job.type === 'asr-job' && !engineObservations.some(result =>
            result.type === 'asr-result' && result.workerId === job.workerId && result.requestId === job.requestId)), undefined, { timeout: 30000, polling: 10 });
          if (reason === 'asr-stop') {
            await stop.click(); snapshot = await host.evaluate(() => stopSnapshot);
          } else {
            snapshot = await host.evaluate(() => ({ at: performance.now(), rows: document.querySelector('#app tbody').innerText,
              pending: engineObservations.filter(job => job.type === 'asr-job' && !engineObservations.some(result =>
                result.type === 'asr-result' && result.workerId === job.workerId && result.requestId === job.requestId)) }));
            // Local document reload is a real original-tab discontinuity, not an
            // injected playback event or synthetic track-ended notification.
            await context.setOffline(false); await page.reload();
          }
          assert.equal(snapshot.pending.length, 1, 'Require one actual unfinished ASR at the cancellation boundary');
        }
        if (reason !== 'navigation') await host.waitForFunction(() => document.querySelector('#app > section').textContent.includes('Stopped.'));
        if (reason === 'navigation') {
          await host.waitForFunction(() => document.querySelector('#connection').textContent.includes('Captured tab navigated'));
          assert.equal(await host.locator('#capture').isDisabled(), true);
        }
        await page.locator('[data-interpreter-overlay]').waitFor({ state: 'detached' });
        const retained = await host.locator('#app tbody').innerText();
        await host.waitForTimeout(2000);
        assert.equal(retained, snapshot.rows);
        assert.equal(await host.locator('#app tbody').innerText(), retained);
        assert.equal(await host.locator('#app .interpreter-live').innerText(), '');
        assert.equal(await prepare.isDisabled(), true);
        const after = await host.evaluate(() => ({ engine: engineObservations, translations: translationObservations }));
        if (reason !== 'translation-stop') {
          const job = snapshot.pending[0];
          assert.ok(after.engine.some(event => event.type === 'terminated' && event.workerId === job.workerId));
          assert.equal(after.engine.some(event => event.type === 'asr-result' && event.workerId === job.workerId && event.requestId === job.requestId), false);
        } else {
          assert.equal(after.translations.length, 1);
          assert.equal(after.translations[0].settled, true);
        }
        assert.equal(await worker.evaluate(async tabId => (await chrome.tabCapture.getCapturedTabs()).some(value => value.tabId === tabId && ['active', 'pending'].includes(value.status)), tab.id), false);
        run.cancellations.push({ reason, snapshot, ...after });
      }
      const identities = [job.identity.sessionId, ...run.cancellations.map(value => value.engine.find(event => event.type === 'asr-job').identity.sessionId)];
      assert.equal(new Set(identities).size, identities.length, 'Every offline recapture must retire the previous ASR session');
    }
    console.log(JSON.stringify({ run }));
    await host.close(); host = undefined;
  }
  observations.checks.push(captureLoss ? 'Owned native audio service failure ends capture during real ASR, retires workers/live output and preserves history; fresh original-tab native action restores real Japanese ASR/native Korean/DOM' : 'Four production-action runs: Japanese top video, English cross-origin iframe video, English audio-only and Japanese no-element Web Audio → real default ASR → native Korean → elapsed comparison and page DOM; Stop retires output/capture');
  assert.ok(network.every(value => !/^https?:\/\/[^/]+:(8765|11434)(\/|$)/u.test(value)));
  assert.deepEqual(observations.pageErrors, []);
  console.log(JSON.stringify({ passed: true, ...observations }));
} catch (error) {
  if (host) {
    observations.failureDom = await host.locator('body').innerText().catch(() => undefined);
    observations.failureEngine = await host.evaluate(() => ({ engine: globalThis.engineObservations, rows: globalThis.rowObservations, translations: globalThis.translationObservations, capture: globalThis.captureObservations })).catch(() => undefined);
  }
  console.error(JSON.stringify({ passed: false, ...observations, error: error.stack })); process.exitCode = 1;
} finally {
  browserProcess?.kill('SIGTERM');
  if (browserProcess && browserExit) {
    const force = setTimeout(() => browserProcess.kill('SIGKILL'), 5000); await browserExit; clearTimeout(force);
  }
  await browser?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
