// B4 production extension path, real selected-video PCM/ASR/native translation.
// B5 sustained/offline acceptance and B6 quality gates remain separate checks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-extension-build");
const fixtures = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8")).clips;
for (const fixture of fixtures) {
  const bytes = await readFile(`tests/fixtures/video-speech/${fixture.language}.webm`);
  assert.equal(bytes.length, fixture.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
}
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: { outDir: output } });
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, "utf8"));
assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.key, undefined);
const observations = { scope: "B4 real production extension selected-video PCM → smallFp16/WebGPU → native Korean translation → comparison/live/overlay DOM; no B5 ten-minute or B6 final quality acceptance",
  pageErrors: [], consoleErrors: [], checks: [], runs: [], productionPermissions: manifest.permissions, modelRequests: [], companionEndpoints: [] };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (["/ja.webm", "/en.webm"].includes(path)) {
      const bytes = await readFile(`tests/fixtures/video-speech${path}`);
      response.setHeader("Content-Type", "video/webm"); response.setHeader("Accept-Ranges", "bytes");
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      if (start > end) { response.writeHead(416, { "Content-Range": `bytes */${bytes.length}` }); response.end(); return; }
      if (range) { response.statusCode = 206; response.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`); }
      response.setHeader("Content-Length", end - start + 1); response.end(bytes.subarray(start, end + 1)); return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><meta charset="utf-8"><title>Real extension speech fixture</title>
      <video id="ja" title="Japanese synthetic speech" src="/ja.webm" controls preload="auto" width="320" height="180"></video>
      <video id="en" title="English synthetic speech" src="/en.webm" controls preload="auto" width="320" height="180"></video>
      <button id="play">Play both videos</button><script>
      ja.volume=0.4;en.volume=0.25;
      play.onclick=()=>Promise.all([ja.play(),en.play()]);
      globalThis.overlayTexts=[];
      new MutationObserver(()=>{
        const overlay=document.querySelector('[data-interpreter-overlay]');
        if(!overlay || overlay.observed)return;overlay.observed=true;
        const read=()=>{const text=overlay.shadowRoot.querySelector('.interpreter-live span')?.textContent;
          if(text && overlayTexts.at(-1)!==text)overlayTexts.push(text)};
        new MutationObserver(read).observe(overlay.shadowRoot,{subtree:true,childList:true,characterData:true});read();
      }).observe(document.documentElement,{subtree:true,childList:true});
      </script>`);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser; let browserProcess; let browserExit; let profile; let host;
try {
  for (const port of [8765, 11434]) {
    const result = await new Promise(done => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); done("listening"); });
      socket.once("error", error => done(error.code));
      socket.setTimeout(1000, () => { socket.destroy(); done("timeout"); });
    });
    observations.companionEndpoints.push({ port, result });
    assert.equal(result, "ECONNREFUSED", "Run this acceptance with companion/Ollama endpoints absent; never stop user apps");
  }
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-extension-profile-"));
  // Same explicit native-component preparation as the accepted B3 CfT harness.
  // Chrome downloads/verifies components; no translated text/readiness is injected.
  const components = ["Chrome TranslateKit", "Chrome TranslateKit en-ja", "Chrome TranslateKit en-ko"];
  await writeFile(resolve(profile, "Local State"), JSON.stringify({ on_device_translation: {
    translate_kit_registered: true, translate_kit_packages: { en_ja_registered: true, en_ko_registered: true },
  } }));
  const configuration = resolve(profile, "cft-config.json");
  await writeFile(configuration, JSON.stringify({ requiredComponents: components,
    requiredComponentsDir: resolve(".ralph/media-framework/chrome-translation-components"), requiredComponentsUpdateTimeout: "120s" }));
  observations.requiredComponents = components;
  browserProcess = spawn(chromium.executablePath(), ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
    `--chrome-for-testing-config=${configuration}`,
    "--enable-unsafe-extension-debugging", "--remote-debugging-port=0", "--window-position=0,30", "--window-size=700,700", "about:blank"], { stdio: "ignore" });
  browserExit = new Promise(done => {
    browserProcess.once("exit", (code, signal) => { observations.browserExit = {code,signal}; done(); });
    browserProcess.once("error", error => { observations.browserExit = {error:error.message}; done(); });
  });
  let port; const deadline = performance.now() + 120000;
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
  console.log(JSON.stringify({ phase: "native components prepared" }));
  page.on("pageerror", error => observations.pageErrors.push(error.message));
  // Load this repository's unchanged manifest after CfT component startup,
  // through its native unpacked-extension test command in the same browser.
  const cdp = await browser.newBrowserCDPSession();
  const {id: loadedId} = await cdp.send("Extensions.loadUnpacked", {path:output});
  const matchesExtension = worker => new URL(worker.url()).host === loadedId;
  const worker = context.serviceWorkers().find(matchesExtension) ?? await context.waitForEvent("serviceworker", { predicate: matchesExtension, timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  assert.equal(extensionId, loadedId);
  const network = [];
  context.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) network.push(url.origin + url.pathname);
    if (url.protocol === "https:" && !observations.modelRequests.includes(url.origin + url.pathname)) observations.modelRequests.push(url.origin + url.pathname);
  });
  await context.addInitScript(() => {
    // Observation only: original workers and their messages/results run unchanged.
    const NativeWorker = Worker; globalThis.engineObservations = [];
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); const url = String(args[0]);
        let state;
        this.addEventListener("message", ({data}) => {
          if (data?.type === "status" && data.status?.state === state) return;
          if (data?.type === "status") state = data.status?.state;
          if (["ready", "status", "error"].includes(data?.type)) engineObservations.push({ url, type: data.type, status: data.status, reason: data.reason });
          if (data?.type === "result" && typeof data.text === "string") engineObservations.push({type:"asr-result",text:data.text,inferenceMs:data.inferenceMs});
        });
      }
      postMessage(message, ...args) {
        if (message.type === "prepare") engineObservations.push({ type: "prepare", candidate: message.candidate, device: message.device });
        if (message.type === "recognize") engineObservations.push({type:"asr-job",samples:message.job.pcm.length,
          language:message.job.language,audioRange:message.job.audioRange});
        return super.postMessage(message, ...args);
      }
    };
  });
  await page.goto(origin); await page.waitForFunction(() => [...document.querySelectorAll("video")].every(video => video.readyState >= 2));
  console.log(JSON.stringify({ phase: "videos loaded" }));
  await page.bringToFront();
  const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] });
  const target = targetInfos.find(info => info.type === "tab" && info.url === `${origin}/`); assert.ok(target);
  const opened = context.waitForEvent("page", { timeout: 15000 }).catch(() => undefined);
  console.log(JSON.stringify({ phase: "native action", sourceTab: sourceTab.id }));
  let actionTimeout;
  try {
    await Promise.race([cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId }),
      browserExit.then(() => {throw new Error(`Owned browser exited during native action: ${JSON.stringify(observations.browserExit)}`)}),
      new Promise((_,reject) => {actionTimeout=setTimeout(()=>reject(new Error('Native action did not respond within 15 seconds')),15000)})]);
  } finally {clearTimeout(actionTimeout)}
  console.log(JSON.stringify({ phase: "native action returned" }));
  host = await opened; assert.ok(host, "Native extension action must open its host document");
  host.on("pageerror", error => observations.pageErrors.push(error.message));
  host.on("console", message => {
    if(message.type()==='error') observations.consoleErrors.push(message.text().replace(/https?:\/\/[^\s"']+/gu,value=>{
      try{const url=new URL(value);return url.origin+url.pathname}catch{return 'remote URL'}
    }));
  });
  await host.waitForURL(`chrome-extension://${extensionId}/host.html?tab=${sourceTab.id}`);
  console.log(JSON.stringify({ phase: "host opened" }));
  // Ordinary window positioning leaves both owned documents visible. No focus/
  // visibility emulation or background engine override is used.
  await worker.evaluate(async sourceTab => {
    await chrome.windows.update(sourceTab.windowId, {left:0,top:30,width:700,height:700});
  }, sourceTab);
  await host.evaluate(async () => {
    const current = await chrome.windows.getCurrent();
    await chrome.windows.update(current.id, {left:710,top:30,width:700,height:700});
  });
  await host.waitForFunction(() => document.querySelector('#video').options.length === 3);
  observations.context = await host.evaluate(async () => ({ secure:isSecureContext, visible:document.visibilityState,
    translator:typeof Translator, gpu:!!navigator.gpu, ja:typeof Translator==='undefined'?null:await Translator.availability({sourceLanguage:'ja',targetLanguage:'ko'}),
    en:typeof Translator==='undefined'?null:await Translator.availability({sourceLanguage:'en',targetLanguage:'ko'}) }));
  assert.equal(observations.context.secure, true); assert.equal(observations.context.visible, "visible");
  assert.equal(observations.context.translator, "function"); assert.equal(observations.context.gpu, true);
  observations.checks.push("Exact production permissions/native action grant; real secure visible extension Translator/WebGPU context");
  const prepare = host.getByRole("button", { name:"Prepare selected language", exact:true });
  const start = host.getByRole("button", { name:"Start interpretation", exact:true });
  const stop = host.getByRole("button", { name:"Stop interpretation", exact:true });
  for (const [index, fixture] of fixtures.entries()) {
    const run = { language:fixture.language, checks:[] }; observations.runs.push(run);
    await host.locator('#language').selectOption(fixture.language);
    const id = await host.locator('#video option').nth(index+1).getAttribute('value');
    await host.locator('#video').selectOption(id); await host.getByRole('button',{name:'Use selected video'}).click();
    await prepare.waitFor({state:'visible'});
    await host.waitForFunction(() => ![...document.querySelectorAll('button')].find(b=>b.textContent==='Prepare selected language').disabled);
    assert.equal(await start.isDisabled(),true);
    await host.evaluate(() => {
      globalThis.rowObservations=[];
      const previous=new Set(document.querySelectorAll('#app tbody tr'));
      const read=()=>{const rows=[...document.querySelectorAll('#app tbody tr')].filter(row=>!previous.has(row)).map(row=>({
        utterance:row.dataset.utteranceId,epoch:row.dataset.epoch,sourceRevision:row.dataset.sourceRevision,
        translationRevision:row.dataset.translationRevision,state:row.dataset.translationState,
        sourceFinal:row.dataset.sourceFinal,translationFinal:row.dataset.translationFinal,
        source:row.cells[0].textContent,time:row.cells[1].textContent,korean:row.cells[2].textContent}));
        const value=JSON.stringify(rows);if(rows.length && rowObservations.at(-1)?.value!==value)rowObservations.push({at:performance.now(),value,rows});};
      globalThis.rowObserver=new MutationObserver(read);rowObserver.observe(document.querySelector('#app tbody'),{subtree:true,childList:true,characterData:true,attributes:true});
      globalThis.engineObservations=[];
    });
    const began=performance.now(); await prepare.click();
    await host.waitForFunction(() => ![...document.querySelectorAll('button')].find(b=>b.textContent==='Start interpretation').disabled || document.querySelector('#app').textContent.includes('Preparation failed:'),undefined,{timeout:240000,polling:100});
    run.preparationMs=performance.now()-began; run.preparation=await host.locator('#app > section').first().innerText();
    run.engine=await host.evaluate(()=>engineObservations);
    console.log(JSON.stringify({preparation:run}));
    assert.equal(await start.isDisabled(),false,run.preparation);
    assert.ok(run.engine.some(event=>event.type==='prepare' && event.candidate==='smallFp16' && event.device==='webgpu'));
    assert.ok(run.engine.some(event=>event.type==='status' && event.status.model.id==='onnx-community/whisper-small' && event.status.state==='ready' && event.status.requiredBytes===487960440));
    assert.ok(run.engine.some(event=>event.type==='status' && event.status.model.id==='onnx-community/silero-vad' && event.status.state==='ready'));
    await page.getByRole('button',{name:'Play both videos'}).click();
    assert.equal(await host.evaluate(()=>document.visibilityState),'visible');
    await start.click(); await page.getByRole('button',{name:'Allow selected video audio'}).click();
    await host.waitForFunction(() => rowObservations.some(event=>event.rows.some(row=>row.state==='paired' && row.sourceFinal==='true' && row.translationFinal==='true')),undefined,{timeout:30000});
    await page.waitForFunction(() => overlayTexts.some(text=>/[가-힣]/u.test(text)),undefined,{timeout:10000});
    run.rows=await host.evaluate(()=>rowObservations);
    run.engine=await host.evaluate(()=>engineObservations);
    run.overlayTexts=await page.evaluate(()=>overlayTexts);
    const final=run.rows.flatMap(event=>event.rows).find(row=>row.state==='paired' && row.sourceFinal==='true' && row.translationFinal==='true'); assert.ok(final);
    assert.match(final.source,fixture.language==='ja'?/[\p{Script=Hiragana}\p{Script=Han}]/u:/[a-z]/iu);
    assert.ok(run.engine.some(event=>event.type==='asr-job' && event.language===fixture.language && event.samples>0 && event.audioRange.endMs>event.audioRange.startMs));
    assert.ok(run.engine.some(event=>event.type==='asr-result' && event.text.trim()));
    assert.match(final.korean,/[가-힣]/u); assert.match(final.time,/^\d+\.\d–\d+\.\d s$/);
    const pending=run.rows.findIndex(event=>event.rows.some(row=>row.utterance===final.utterance && row.epoch===final.epoch && row.state==='pending'));
    const paired=run.rows.findIndex(event=>event.rows.some(row=>row.utterance===final.utterance && row.epoch===final.epoch && row.state==='paired'));
    assert.ok(pending>=0 && pending<paired,'Real ASR original must paint before its native translation');
    assert.ok(run.overlayTexts.some(text=>final.korean.trim().startsWith(text.trim()) && /[가-힣]/u.test(text)),'Real paired Korean must reach the selected-page overlay');
    assert.match(await host.locator('#app .interpreter-live').innerText(),/[가-힣]/u);
    run.playback=await page.evaluate(()=>[ja,en].map(video=>({paused:video.paused,muted:video.muted,volume:video.volume,time:video.currentTime})));
    assert.deepEqual(run.playback.map(video=>({paused:video.paused,muted:video.muted,volume:video.volume})),[{paused:false,muted:false,volume:0.4},{paused:false,muted:false,volume:0.25}]);
    run.checks.push('Actual final ASR/native Korean, original-first comparison/video time, host live and selected-video overlay');
    await stop.click(); await host.waitForFunction(()=>document.querySelector('#app > section').textContent.includes('Stopped.'));
    await page.locator('[data-interpreter-overlay]').waitFor({state:'detached'});
    const retained=await host.locator('#app tbody').innerText();
    await host.waitForTimeout(500);
    assert.equal(await host.locator('#app tbody').innerText(),retained);
    assert.equal(await host.locator('#app .interpreter-live').innerText(),'');
    assert.equal(await page.locator('[data-interpreter-overlay]').count(),0);
    assert.equal(await start.isDisabled(),true);
    assert.equal(await page.evaluate(()=>[ja,en].every(video=>!video.paused && !video.muted)),true);
    run.checks.push('Stop clears both live surfaces; comparison retained; no late DOM update; original playback continues');
    await host.evaluate(()=>rowObserver.disconnect());
    await page.evaluate(()=>{ja.pause();en.pause();ja.currentTime=0;en.currentTime=0;overlayTexts=[]});
    await page.waitForFunction(()=>!ja.seeking && !en.seeking);
    console.log(JSON.stringify({run}));
  }
  assert.ok(network.every(value=>!/^https?:\/\/[^/]+:(8765|11434)(\/|$)/u.test(value)),'No companion/Ollama network use');
  assert.deepEqual(observations.pageErrors,[]);
  console.log(JSON.stringify({passed:true,...observations}));
} catch(error) {
  if(host) {
    observations.failureDom=await host.locator('body').innerText().catch(()=>undefined);
    observations.failureEngine=await host.evaluate(()=>({engine:globalThis.engineObservations,rows:globalThis.rowObservations})).catch(()=>undefined);
  }
  console.error(JSON.stringify({passed:false,...observations,error:error.stack}));process.exitCode=1;
} finally {
  browserProcess?.kill('SIGTERM');
  if (browserProcess && browserExit) {
    const force = setTimeout(() => browserProcess.kill('SIGKILL'), 5000);
    await browserExit; clearTimeout(force);
  }
  await browser?.close();
  if(profile)await rm(profile,{recursive:true,force:true});
  await new Promise(done=>server.close(done));
}
