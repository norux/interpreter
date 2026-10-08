// Production native action/host + real tab playback. Synthetic accepted-caption
// messages exercise no-video DOM only; this is not real ASR/translation acceptance.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-tab-host-build");
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: { outDir: output } });
await build({ configFile: false, root: resolve("tests/fixtures/tab-capture"), logLevel: "warn", build: {
  outDir: output, emptyOutDir: false, rollupOptions: { input: {
    observer: resolve("tests/fixtures/tab-capture/output.html"),
    "overlay-channel": resolve("apps/chrome/overlay-channel.ts"),
  }, preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, "utf8"));
assert.deepEqual(manifest.permissions,["activeTab","scripting","tabCapture"]);
assert.equal(manifest.host_permissions,undefined); assert.equal(manifest.action.default_popup,undefined);
assert.equal(manifest.permissions.includes('offscreen'),false);
const server = createServer((_request,response) => {
  response.setHeader('Content-Type','text/html');
  response.end(`<!doctype html><title>Production tab source</title><button id="play">Play Web Audio</button>
    <button id="fullscreen">Fullscreen page</button><script>
    play.onclick=async()=>{globalThis.audio=new AudioContext();const tone=audio.createOscillator(),gain=audio.createGain();
      tone.frequency.value=440;gain.gain.value=0.1;tone.connect(gain).connect(audio.destination);tone.start();await audio.resume()};
    fullscreen.onclick=()=>document.documentElement.requestFullscreen();</script>`);
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const profile = await mkdtemp(resolve('.ralph/media-framework/chrome-tab-host-profile-'));
let context;
const observations = { scope:'Production native action/tab host capture/output/controls and synthetic no-video page captions; no model loading, PCM-to-ASR/native translation or accuracy acceptance',
  pageErrors:[], checks:[], output:[] };
function amplitude(samples,rate,frequency) {
  let sin=0,cos=0,weight=0;
  for(let i=0;i<samples.length;i++) {
    const taper=0.5-0.5*Math.cos(2*Math.PI*i/(samples.length-1)),phase=2*Math.PI*frequency*i/rate;
    sin+=samples[i]*taper*Math.sin(phase);cos+=samples[i]*taper*Math.cos(phase);weight+=taper;
  }
  return 2*Math.hypot(sin,cos)/weight;
}
try {
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,
    ignoreDefaultArgs:['--disable-extensions','--mute-audio'],args:[`--disable-extensions-except=${output}`,`--load-extension=${output}`,
      '--enable-unsafe-extension-debugging','--auto-select-tab-capture-source-by-title=Output under test','--enable-usermedia-screen-capturing']});
  observations.browser=context.browser().version();observations.platform=`${process.platform}/${process.arch}`;
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).host;
  const page=await context.newPage();page.on('pageerror',error=>observations.pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByRole('button',{name:'Play Web Audio',exact:true}).click();
  assert.equal(await page.locator('video,audio').count(),0);
  await page.bringToFront();
  const tab=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0]);
  const cdp=await context.browser().newBrowserCDPSession();
  const nativeTarget=async()=> {
    const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});
    const target=targetInfos.find(value=>value.url===page.url());assert.ok(target);return target;
  };
  async function openHost() {
    await page.bringToFront();const target=await nativeTarget();
    const opened=context.waitForEvent('page',{timeout:15000});
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});
    const host=await opened;host.on('pageerror',error=>observations.pageErrors.push(error.message));
    await host.waitForURL(`chrome-extension://${extensionId}/tab-host.html?tab=${tab.id}`);
    await host.waitForFunction(()=>document.querySelector('#connection').textContent.startsWith('Capturing all audio')
      || document.querySelector('#connection').textContent.startsWith('Tab capture unavailable'));
    assert.match(await host.locator('#connection').textContent(),/^Capturing all audio/);
    assert.equal(await host.locator('#video,#confirm').count(),0);
    assert.equal(await host.locator('#app th').nth(1).textContent(),'Capture elapsed');
    assert.equal(await host.getByRole('button',{name:'Prepare selected language',exact:true}).isEnabled(),true);
    assert.equal(await host.getByRole('button',{name:'Start interpretation',exact:true}).isDisabled(),true);
    assert.equal(await host.locator('#capture').isDisabled(),true);
    return host;
  }
  async function active() {
    return worker.evaluate(async tabId=>(await chrome.tabCapture.getCapturedTabs()).some(value=>value.tabId===tabId && ['active','pending'].includes(value.status)),tab.id);
  }
  async function released() {
    const deadline=performance.now()+5000;while(await active() && performance.now()<deadline) await page.waitForTimeout(50);
    assert.equal(await active(),false);
  }
  async function observe(surface,label) {
    const oldTitle=await surface.title();await surface.evaluate(()=>{document.title='Output under test'});
    const observer=await context.newPage();observer.on('pageerror',error=>observations.pageErrors.push(error.message));
    try {
      await observer.goto(`chrome-extension://${extensionId}/output.html`);await observer.getByRole('button').click();
      await observer.waitForFunction(()=>globalThis.outputReady || globalThis.error);
      assert.equal(await observer.evaluate(()=>globalThis.error),undefined);
      const rate=await observer.evaluate(()=>globalThis.outputContext.sampleRate);
      const deadline=performance.now()+5000;let level;
      do {await observer.waitForTimeout(100);level=amplitude(await observer.evaluate(()=>globalThis.measure()),rate,440)}
      while(Math.abs(level/0.1-1)>=0.03 && performance.now()<deadline);
      assert.ok(Math.abs(level/0.1-1)<0.03,`${label}: native output ${level} must match 0.1 within 3%`);
      observations.output.push({label,amplitude:level});return level;
    } finally {await observer.close();if(!surface.isClosed()) await surface.evaluate(title=>{document.title=title},oldTitle)}
  }
  const host=await openHost();assert.equal(await active(),true);
  await host.waitForFunction(()=>document.querySelector('#overlay-status').textContent.startsWith('Page captions available'));
  await page.bringToFront();
  const duplicateOpened=context.waitForEvent('page',{timeout:15000});
  await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:(await nativeTarget()).targetId});
  const duplicate=await duplicateOpened;
  await duplicate.waitForFunction(()=>document.querySelector('#connection').textContent.startsWith('Tab capture unavailable'));
  assert.match(await duplicate.locator('#connection').textContent(),/active stream/i);
  assert.equal(await active(),true,'A rejected second host must leave the first capture active');
  // A rejected host must not replace the already running host's page output.
  await duplicate.waitForTimeout(200);
  assert.match(await host.locator('#overlay-status').textContent(),/^Page captions available/);
  await duplicate.close();
  observations.checks.push('A second native action reports actual duplicate-capture failure without replacing the first capture or its overlay connection');
  const preparationOutput=await observe(host,'production capture before model preparation');
  observations.checks.push('Unmodified production action/permissions, native action grant, no-video original-tab capture before engines and optional overlay');
  // Inject synthetic accepted revisions only through the actual validated port.
  // Replacing the overlay connection must leave the real capture running.
  await host.evaluate(async tabId=>{
    const {createRemoteVideoOutput,tabOverlayChannelName}=await import('./overlay-channel.js');
    globalThis.syntheticFailures=[];
    globalThis.display=createRemoteVideoOutput(chrome.tabs.connect(tabId,{name:tabOverlayChannelName,frameId:0}),message=>syntheticFailures.push(message));
    globalThis.target={id:'synthetic-tab',documentId:'synthetic-host',frameId:'tab',scope:'tab-mix',tabId};
    globalThis.identity={sessionId:'synthetic-tab-session',targetId:target.id,epoch:0};
    globalThis.source={identity,utteranceId:'synthetic-row',sourceRevision:1,language:'ja',text:'<img src=x> synthetic original',final:true,audioRange:{startMs:0,endMs:1000}};
    display.activate(target,identity);display.compare({source,translation:{state:'pending'}});
  },tab.id);
  const cue=page.locator('[data-interpreter-overlay] .interpreter-live span').first();await cue.waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span').textContent.includes('synthetic original'));
  assert.equal(await page.locator('[data-interpreter-overlay] img').count(),0);
  await host.waitForFunction(()=>document.querySelector('#overlay-status').textContent.includes('disconnected'));
  assert.equal(await active(),true,'Optional overlay failure must not cancel the actual tab input');
  await host.evaluate(()=>display.compare({source,translation:{state:'paired',revision:{identity,utteranceId:source.utteranceId,sourceRevision:1,translationRevision:1,
    languages:{source:'ja',target:'ko'},text:'합성 탭 자막',final:true}}}));
  await page.waitForFunction(()=>document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span').textContent==='합성 탭 자막');
  await page.bringToFront();await page.getByRole('button',{name:'Fullscreen page',exact:true}).click();
  await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);
  assert.equal(await page.locator('[data-interpreter-overlay]').evaluate(node=>getComputedStyle(node).display),'flex');
  await page.evaluate(()=>document.exitFullscreen());
  await host.evaluate(()=>{display.clear(identity);display.compare({source,translation:{state:'pending'}})});
  await page.locator('[data-interpreter-overlay]').waitFor({state:'detached'});
  assert.deepEqual(await host.evaluate(()=>syntheticFailures),[]);
  observations.checks.push('Synthetic original/Korean page captions on a no-video page, safe text, fullscreen container, clear/late rejection and optional-port failure isolation');
  await host.locator('#language').selectOption('en');
  await host.waitForFunction(()=>document.querySelector('#connection').textContent.startsWith('Capturing all audio') && !document.querySelector('#language').disabled);
  assert.equal(await host.getByRole('button',{name:'Start interpretation',exact:true}).isDisabled(),true);
  assert.equal(await host.getByRole('button',{name:'Prepare selected language',exact:true}).isEnabled(),true);
  await observe(host,'English language change recaptures original tab');
  observations.checks.push('Language change retires the old capture/session before recapturing the original tab for fresh preparation');
  for(let round=0;round<2;round++) {
    await host.getByRole('button',{name:'Stop interpretation',exact:true}).click();await released();
    await host.waitForFunction(()=>!document.querySelector('#capture').disabled);
    assert.equal(await host.getByRole('button',{name:'Prepare selected language',exact:true}).isDisabled(),true);
    await observe(page,`site output after production Stop ${round+1}`);
    await host.locator('#capture').click();
    await host.waitForFunction(()=>document.querySelector('#connection').textContent.startsWith('Capturing all audio')
      || document.querySelector('#connection').textContent.startsWith('Tab capture unavailable'));
    assert.match(await host.locator('#connection').textContent(),/^Capturing all audio/);
    const level=await observe(host,`production repeat capture ${round+1}`);
    assert.ok(Math.abs(level/preparationOutput-1)<0.12);
  }
  await host.close();await released();await observe(page,'site output after production host closure');
  observations.checks.push('Two production Stop/recapture cycles and host closure release capture and restore independently measured site output');
  const next=await openHost();await page.reload();await released();
  await next.waitForFunction(()=>document.querySelector('#connection').textContent.includes('Captured tab navigated'));
  assert.equal(await next.locator('#capture').isDisabled(),true);assert.equal(await next.locator('#language').isDisabled(),true);
  assert.equal(await next.getByRole('button',{name:'Prepare selected language',exact:true}).isDisabled(),true);
  observations.checks.push('Original-tab navigation invalidates the host and requires a fresh action instead of following a new document');
  assert.deepEqual(observations.pageErrors,[]);
  console.log(JSON.stringify({passed:true,...observations}));
} catch(error) {console.error(JSON.stringify({passed:false,...observations,error:error.stack}));process.exitCode=1}
finally {await context?.close();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true})}
