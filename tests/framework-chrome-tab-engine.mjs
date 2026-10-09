import {createReadStream} from "node:fs";
// Production popup → offscreen capture/real turbo WebGPU/native Korean → page and reference.
// Synthetic speech fixtures; no public-video, ten-minute or strict latency acceptance.
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
const lifecycle = process.argv.includes("--lifecycle");
const modelDirectory = process.env.INTERPRETER_TEST_MODEL_DIRECTORY;
const modelFiles = [
  ["encoder_model_fp16.onnx", "interpreter-turbo-encoder-verified.onnx", 1274342603, "fdadc70836e6b028fd5e580417c312208dad073d2d01e509e2d127c1373399d8"],
  ["decoder_model_merged_fp16.onnx", "interpreter-turbo-decoder.onnx", 344227339, "fdf10afca73a0c7bf87286cfb96cf7028a9edbc9bb02512509a526f95b126c9d"],
];
if (modelDirectory) for (const [, filename, bytes, sha256] of modelFiles) {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(resolve(modelDirectory, filename))) { hash.update(chunk); size += chunk.length; }
  assert.equal(size, bytes); assert.equal(hash.digest("hex"), sha256);
}
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
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, "utf8"));
assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "tabCapture", "offscreen"]);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.action.default_popup, "popup.html");
const observations = { scope: "Production popup/offscreen ownership, real turbo WebGPU/native Korean/page/reference lifetime and source retirement; no strict latency/public-video/ten-minute acceptance",
  pageErrors: [], checks: [], runs: [], companionEndpoints: [], modelProvisioning: modelDirectory ? "Two SHA-256 verified official ONNX files seeded into extension cache; actual remaining model downloads and real inference" : "Official pinned model downloads", translatorProvisioning: "Chrome-managed TranslateKit and ja/en/ko language components; no substituted translations" };
function serve(request, response) {
  const url = new URL(request.url, "http://localhost");
  const model = modelDirectory && modelFiles.find(([, filename]) => url.pathname === `/${filename}`);
  if (model) {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Access-Control-Allow-Origin": "*", "Content-Length": model[2] });
    createReadStream(resolve(modelDirectory, model[1])).pipe(response); return;
  }
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
if (modelDirectory) manifest.content_security_policy.extension_pages += ` ${origin}`;
await writeFile(`${output}/manifest.json`,JSON.stringify(manifest));
let browserProcess; let browserExit; let browser; let profile;
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

  async function state() {
    return worker.evaluate(async () => (await chrome.runtime.sendMessage({channel:'interpreter-background-v1',command:{type:'snapshot'}}))?.snapshot);
  }
  async function waitState(predicate, timeout=120000, allowFailure=false) {
    const deadline=performance.now()+timeout;
    while(performance.now()<deadline) {
      const value=await state();
      if(value?.state==='failed'&&!allowFailure) throw Error(JSON.stringify(value));
      if(predicate(value)) return value;
      await new Promise(done=>setTimeout(done,100));
    }
    throw Error(`State timeout ${JSON.stringify(await state())}`);
  }

  async function attach(targetId) {
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});
    let next=0;const pending=new Map();
    cdp.on('Target.receivedMessageFromTarget',event=>{
      if(event.sessionId!==sessionId)return;
      const message=JSON.parse(event.message);if(!message.id)return;
      const operation=pending.get(message.id);pending.delete(message.id);
      if(message.error)operation.reject(Error(message.error.message));else operation.resolve(message.result);
    });
    async function send(method,params={}) {
      const id=++next;const result=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
      await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});return result;
    }
    async function evaluate(expression) {
      const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
    }
    return {send,evaluate,close:()=>cdp.send('Target.closeTarget',{targetId}),async click(selector) {
      const rect=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el.disabled)throw Error('Disabled '+el.textContent);const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});
    }};
  }
  async function openPopup() {
    await page.bringToFront();
    const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});
    const target=targetInfos.find(value=>value.url===page.url());assert.ok(target);
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});
    const deadline=performance.now()+10000;
    while(performance.now()<deadline) {
      const targets=(await cdp.send('Target.getTargets')).targetInfos;
      const popup=targets.find(value=>value.url===`chrome-extension://${extensionId}/popup.html`);
      if(popup) {
        const surface=await attach(popup.targetId);
        while(!await surface.evaluate(`document.querySelector('#status')?.textContent && document.querySelector('#status').textContent!=='연결 중…'`)) await new Promise(done=>setTimeout(done,100));
        return surface;
      }
      await new Promise(done=>setTimeout(done,100));
    }
    throw Error('No action popup');
  }

  const scenarios = captureLoss || lifecycle ? [{language:'ja',mode:'web-audio'}] : [
    {language:'ja',mode:'video'}, {language:'en',mode:'iframe'}, {language:'en',mode:'audio'}, {language:'ja',mode:'web-audio'},
  ];
  let runtime;
  for (const scenario of scenarios) {
    await page.goto(`${origin}/?language=${scenario.language}&mode=${scenario.mode}`);
    const source=scenario.mode==='iframe'?page.frameLocator('iframe'):page;
    let popup=await openPopup();
    if (!runtime) {
      const targets=(await cdp.send('Target.getTargets')).targetInfos;
      const target=targets.find(value=>value.url===`chrome-extension://${extensionId}/offscreen.html`);assert.ok(target);
      runtime=await attach(target.targetId);
      if (process.env.INTERPRETER_TEST_SCREENSHOT) {
        const shot=await popup.send('Page.captureScreenshot');
        await writeFile(process.env.INTERPRETER_TEST_SCREENSHOT,Buffer.from(shot.data,'base64'));
      }
      assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:[chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]}))).length,1);
      assert.equal(await runtime.evaluate("typeof Translator"),'function');
      await runtime.evaluate(`(()=>{
        globalThis.runtimeObservations=[];globalThis.translationCalls=[];
        const NativeWorker=Worker;let next=0;
        globalThis.Worker=class extends NativeWorker{
          constructor(...args){super(...args);this.observedId=++next;let state;
            this.addEventListener('message',({data})=>{
              if(data.type==='status'){if(state===data.status.state)return;state=data.status.state;}
              if(data.type==='result'&&typeof data.text!=='string')return;
              runtimeObservations.push({worker:this.observedId,at:performance.now(),...data});
              if(runtimeObservations.length>300)runtimeObservations.shift();
            });}
          postMessage(message,...args){
            if(message.type==='recognize')runtimeObservations.push({type:'asr-job',worker:this.observedId,requestId:message.requestId,
              identity:message.job.identity,utteranceId:message.job.utteranceId,language:message.job.language,audioRange:message.job.audioRange,samples:message.job.pcm.length});
            return super.postMessage(message,...args);}
          terminate(){runtimeObservations.push({type:'terminated',worker:this.observedId});return super.terminate();}
        };
        const create=Translator.create.bind(Translator);
        Translator.create=async(...args)=>{const translator=await create(...args);const translate=translator.translate.bind(translator);
          translator.translate=async(text,...options)=>{const call={source:text};translationCalls.push(call);
            const result=await translate(text,...options);call.korean=result;return result;};return translator;};
      })()`);
      if (modelDirectory) await worker.evaluate(async ({origin,files}) => {
        const version='360ebcde2559d60bb474678be3c1de9ef347d01a';
        const cache=await caches.open(`interpreter-asr-${version}-fp16`);
        for (const [name,filename,bytes] of files) {
          const response=await fetch(`${origin}/${filename}`);assertResponse(response);
          await cache.put(`https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/${version}/onnx/${name}`,
            new Response(response.body,{headers:{'Content-Length':String(bytes)}}));
        }
        function assertResponse(response) {if(!response.ok||!response.body)throw Error('Verified test model unavailable');}
      },{origin,files:modelFiles});
    }
    if (scenario.language==='en') await popup.evaluate("document.querySelector('#language').value='en'");
    await popup.click('#prepare');
    assert.equal((await state()).state,'preparing');
    await popup.close();
    const switched=await context.newPage();await switched.goto('about:blank');await switched.bringToFront();
    const ready=await waitState(value=>value?.state==='ready',240000);
    assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:[chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]}))).length,1);
    await switched.close();
    console.log(JSON.stringify({phase:'hidden-ready',...scenario,message:ready.message}));
    popup=await openPopup();await popup.click('#start');
    await waitState(value=>value?.state==='running');await popup.close();
    await source.getByRole('button',{name:'Play speech',exact:true}).click();
    const first=await waitState(value=>value?.captions.some(c=>c.translation.state==='paired'),60000);
    const paired=first.captions.find(c=>c.translation.state==='paired');
    assert.match(paired.translation.revision.text,/[가-힣]/);
    assert.equal(paired.source.language,scenario.language);
    const jobs=await runtime.evaluate('runtimeObservations');
    const job=jobs.find(e=>e.type==='asr-job'&&e.utteranceId===paired.source.utteranceId&&e.identity.sessionId===paired.source.identity.sessionId);
    const result=jobs.find(e=>e.type==='result'&&e.worker===job?.worker&&e.requestId===job?.requestId);
    assert.ok(job&&result);assert.equal(paired.source.text,result.text);
    if(observations.runs.length===0) assert.ok(jobs.some(e=>e.type==='status'&&e.status.state==='downloading'),'Real model file downloads complete after popup closure and tab switch');
    assert.equal(job.samples,(job.audioRange.endMs-job.audioRange.startMs)*16);
    await page.waitForFunction(()=>document.querySelector('[data-interpreter-overlay]')?.shadowRoot.querySelector('.interpreter-live span')?.textContent.match(/[가-힣]/),undefined,{timeout:10000});
    popup=await openPopup();
    const opened=context.waitForEvent('page');await popup.click('#reference');
    const reference=await opened;await popup.close();
    await reference.waitForFunction(()=>document.querySelector('#app tbody tr[data-translation-state="paired"]'));
    assert.equal(await reference.locator('button,select').count(),0,'Reference view has no execution controls');
    const rows=await reference.locator('#app tbody').innerText();await reference.close();
    const ids=new Set(first.captions.map(c=>c.source.utteranceId));
    const second=await waitState(value=>value?.captions.some(c=>!ids.has(c.source.utteranceId)&&c.translation.state==='paired'),60000);
    assert.equal(second.identity.sessionId,first.identity.sessionId);
    assert.equal(await worker.evaluate(async tabId=>(await chrome.tabCapture.getCapturedTabs()).some(t=>t.tabId===tabId&&t.status==='active'),first.tabId),true);
    popup=await openPopup();
    const reopened=context.waitForEvent('page');await popup.click('#reference');
    const restored=await reopened;await popup.close();
    await restored.waitForFunction(()=>document.querySelectorAll('#app tbody tr[data-translation-state="paired"]').length>=2);
    assert.ok((await restored.locator('#app tbody').innerText()).includes(rows.split('\n')[0]));
    await restored.close();
    observations.runs.push({...scenario,captions:second.captions,hiddenPreparation:true,referenceClosure:true,referenceRestoration:true});
    console.log(JSON.stringify({phase:'reference-independent',...scenario,paired:second.captions.filter(c=>c.translation.state==='paired').length}));
    if(captureLoss) {
      const deadline=performance.now()+60000;let pending;
      while(performance.now()<deadline) {
        const events=await runtime.evaluate('runtimeObservations');
        pending=events.find(e=>e.type==='asr-job'&&!events.some(r=>r.type==='result'&&r.worker===e.worker&&r.requestId===e.requestId));
        if(pending)break;await new Promise(done=>setTimeout(done,10));
      }
      assert.ok(pending,'Require unfinished actual ASR before native capture loss');
      const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');
      assert.equal(processInfo.find(p=>p.type==='browser').id,browserProcess.pid);
      const audio=processInfo.filter(p=>p.type==='audio.mojom.AudioService');assert.equal(audio.length,1);
      assert.equal(Number(execFileSync('ps',['-p',String(audio[0].id),'-o','ppid='],{encoding:'utf8'}).trim()),browserProcess.pid);
      process.kill(audio[0].id,'SIGTERM');
      await waitState(value=>value?.state==='idle');
      const events=await runtime.evaluate('runtimeObservations');
      assert.ok(events.some(e=>e.type==='terminated'&&e.worker===pending.worker));
      assert.equal(events.some(e=>e.type==='result'&&e.worker===pending.worker&&e.requestId===pending.requestId),false);
      observations.checks.push('Owned Chrome native audio-service loss retires unfinished real ASR and capture');
    } else {
      popup=await openPopup();await popup.click('#stop');
      await waitState(value=>value?.state==='idle');await popup.close();
    }
    await page.locator('[data-interpreter-overlay]').waitFor({state:'detached'});
    assert.equal(await worker.evaluate(async()=>(await chrome.tabCapture.getCapturedTabs()).some(t=>['active','pending'].includes(t.status))),false);
    const retained=await state();await new Promise(done=>setTimeout(done,1200));
    assert.deepEqual((await state()).captions,retained.captions,'Stopped session accepts no late caption');
  }
  // Preparation is owned by the original tab even when the popup disappears.
  let popup=await openPopup();await popup.click('#prepare');await popup.close();
  await page.reload();await waitState(value=>value?.state==='idle',10000,true);
  popup=await openPopup();await popup.click('#prepare');await popup.close();
  await page.close();await waitState(value=>value?.state==='idle',10000,true);
  observations.checks.push('Popup closure/tab switching completes preparation hidden; reference closure preserves next real translated caption and page overlay; reopening restores bounded history; Stop clears overlay/capture and rejects late captions; source navigation/closure stops preparation');
  assert.deepEqual(observations.pageErrors,[]);
  console.log(JSON.stringify({passed:true,...observations}));
} catch(error) {console.error(JSON.stringify({passed:false,error:error.stack}));process.exitCode=1}
finally {await browser?.close();browserProcess?.kill();await browserExit;await new Promise(done=>server.close(done));if(profile) await rm(profile,{recursive:true,force:true})}
