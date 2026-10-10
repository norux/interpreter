import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/model-options-extension");
await build({configFile:"vite.chrome.config.ts",logLevel:"warn",build:{outDir:output}});
const audio = await readFile("tests/fixtures/video-speech/en.webm");
const server = createServer((request,response)=>{
  if(request.url === "/en.webm") {response.setHeader("Content-Type","video/webm");response.end(audio);return;}
  response.setHeader("Content-Type","text/html");response.end('<title>Model options audio fixture</title><video id="media" src="/en.webm" controls loop></video><button id="play">Play</button><script>play.onclick=()=>media.play()</script>');
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const report = {scope:"Actual extension action → separate Advanced selectors → pinned Tiny q8 / M2M100 q8 downloads → offscreen tab capture → Korean page captions; synthetic English audio, not a model accuracy benchmark",checks:[]};
let profile;let processChrome;let exited;let browser;
try {
  profile = await mkdtemp(resolve(".ralph/media-framework/model-options-profile-"));
  processChrome = spawn(chromium.executablePath(),["--no-first-run","--no-default-browser-check",`--user-data-dir=${profile}`,"--enable-unsafe-extension-debugging","--remote-debugging-port=0","about:blank"],{stdio:"ignore"});
  exited = new Promise(done=>{processChrome.once("exit",done);processChrome.once("error",done);});
  let port;const deadline=performance.now()+60000;
  while(performance.now()<deadline){try{port=(await readFile(resolve(profile,"DevToolsActivePort"),"utf8")).split("\n")[0];break;}catch{await new Promise(done=>setTimeout(done,100));}}
  assert.ok(port);browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
  const context=browser.contexts()[0];const page=await context.newPage();
  const cdp=await browser.newBrowserCDPSession();const {id:extensionId}=await cdp.send("Extensions.loadUnpacked",{path:output});
  const worker=context.serviceWorkers().find(w=>new URL(w.url()).host===extensionId) ?? await context.waitForEvent("serviceworker",{predicate:w=>new URL(w.url()).host===extensionId});
  async function state(){return worker.evaluate(async()=>(await chrome.runtime.sendMessage({channel:"interpreter-background-v1",command:{type:"snapshot"}}))?.snapshot);}
  async function waitState(predicate,timeout=600000){const until=performance.now()+timeout;while(performance.now()<until){const value=await state();if(value?.state==="failed")throw Error(JSON.stringify(value));if(predicate(value))return value;await new Promise(done=>setTimeout(done,100));}throw Error(JSON.stringify(await state()));}
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

  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  let popup=await openPopup();
  await popup.evaluate("document.querySelector('#language').value='en';document.querySelector('#language').dispatchEvent(new Event('change'))");
  const advancedReady=context.waitForEvent("page",{predicate:p=>p.url().includes("advanced.html")});
  await popup.click("#advanced");
  const advanced=await advancedReady;await advanced.waitForLoadState();
  await advanced.waitForFunction(()=>document.querySelector("#recognition").options.length===6);
  await advanced.locator("#recognition").selectOption("tiny");
  await advanced.waitForFunction(()=>!document.querySelector("#translation").disabled);
  await advanced.locator("#translation").selectOption("m2m100");
  await advanced.waitForFunction(()=>JSON.parse(localStorage.getItem("jamak-model-options-v1")).translation==="m2m100");
  const prepared=await waitState(s=>s?.state==="ready");
  assert.deepEqual(prepared.options,{recognition:"tiny",translation:"m2m100"});
  assert.ok(prepared.models.some(m=>m.name.includes("Tiny")));
  assert.ok(prepared.models.some(m=>m.name.includes("M2M100")));
  report.models=prepared.models;report.checks.push("Actual Advanced sender authorization, independent selectors, download on selection, pinned resident model preparation");
  await advanced.reload();await advanced.waitForFunction(()=>document.querySelector("#translation").value==="m2m100");
  assert.equal(await advanced.locator("#recognition").inputValue(),"tiny");report.checks.push("Persisted Advanced selectors after reload");
  await advanced.screenshot({path:resolve(".ralph/media-framework/advanced-real.png")});await advanced.close();
  popup=await openPopup();
  assert.match(await popup.evaluate("document.querySelector('#model-list').textContent"),/Tiny/);
  await popup.click("#start");await waitState(s=>s?.state==="running",30000);await popup.close();
  await page.bringToFront();await page.locator("#play").click();
  const captioned=await waitState(s=>s?.captions.some(c=>c.translation.state==="paired"),60000);
  const caption=captioned.captions.find(c=>c.translation.state==="paired");
  assert.equal(caption.source.language,"en");assert.match(caption.translation.revision.text,/[가-힣]/u);
  assert.equal(caption.source.sourceRevision,caption.translation.revision.sourceRevision);
  report.caption=caption;report.checks.push("Real tab capture produced paired Korean caption");
  await page.waitForFunction(()=>document.querySelector('[data-interpreter-overlay]')?.shadowRoot.querySelector('.interpreter-live span')?.textContent.match(/[가-힣]/u),undefined,{timeout:10000});
  report.caption=caption;report.checks.push("Persisted selections after reload, popup recognizes prepared models, real Tiny transcription and M2M100 Korean output in page DOM after both windows close");
  const runtimeTarget=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/offscreen.html`);
  const runtime=await attach(runtimeTarget.targetId);
  await runtime.evaluate(`(()=>{
    globalThis.modelDiagnostics={jobs:[],responses:[],pcmFrames:0,positiveFrames:0,lastRms:0};
    const OriginalWorker=Worker;globalThis.Worker=class extends OriginalWorker {
      constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='result'||data.type==='error') {modelDiagnostics.responses.push({type:data.type,text:data.text,reason:data.reason,inferenceMs:data.inferenceMs});if(modelDiagnostics.responses.length>30)modelDiagnostics.responses.shift();}});}
      postMessage(message,...args){if(message.type==='recognize'){const pcm=message.job.pcm;modelDiagnostics.jobs.push({language:message.job.language,samples:pcm.length,rms:Math.sqrt(pcm.reduce((s,x)=>s+x*x,0)/pcm.length)});if(modelDiagnostics.jobs.length>30)modelDiagnostics.jobs.shift();}return super.postMessage(message,...args);}
    };
    const OriginalWorklet=AudioWorkletNode;globalThis.AudioWorkletNode=class extends OriginalWorklet {
      constructor(...args){super(...args);this.port.addEventListener('message',({data})=>{if(data?.pcm?.byteLength){const pcm=new Float32Array(data.pcm);const rms=Math.sqrt(pcm.reduce((s,x)=>s+x*x,0)/pcm.length);modelDiagnostics.pcmFrames++;if(rms>0.001)modelDiagnostics.positiveFrames++;modelDiagnostics.lastRms=rms;}});}
    };
  })()`);
  popup=await openPopup();
  const switching=context.waitForEvent("page",{predicate:p=>p.url().includes("advanced.html")});
  await popup.click("#advanced");const advancedSwitch=await switching;await advancedSwitch.waitForLoadState();
  await advancedSwitch.locator("#recognition").selectOption("base");
  const changed=await waitState(s=>s?.state==="ready" && s.options.recognition==="base");
  assert.equal(changed.options.translation,"m2m100");assert.ok(changed.models.some(m=>m.name.includes("Base")));
  assert.equal(await page.evaluate(()=>document.querySelector('[data-interpreter-overlay]')),null,"Changing a live model retires the old overlay");
  await advancedSwitch.close();
  report.mediaBeforeRestart=await page.evaluate(()=>({paused:media.paused,ended:media.ended,time:media.currentTime,readyState:media.readyState}));
  await page.evaluate(()=>{media.pause();media.currentTime=0;});
  popup=await openPopup();await popup.click("#start");await waitState(s=>s?.state==="running",30000);await popup.close();await page.bringToFront();await page.locator("#play").click();
  let second;try{second=await waitState(s=>s?.captions.some(c=>c.translation.state==="paired"),60000);}finally{report.diagnostics=await runtime.evaluate("modelDiagnostics");}
  assert.notEqual(second.identity.sessionId,caption.source.identity.sessionId);
  assert.match(second.captions.find(c=>c.translation.state==="paired").translation.revision.text,/[가-힣]/u);
  report.checks.push("Changing recognition during live captioning stops the old session, downloads/prepares Base, retains M2M100, and produces real Korean captions in a fresh session");
  popup=await openPopup();await popup.click("#stop");await waitState(s=>s?.state==="ready");await popup.close();
  assert.equal(await page.evaluate(()=>document.querySelector('[data-interpreter-overlay]')),null);
  report.checks.push("Stop clears page overlay and can reuse downloaded selected models");report.passed=true;
} catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;}
finally {
  processChrome?.kill("SIGTERM");await browser?.close();await exited;
  if(profile && report.passed)await rm(profile,{recursive:true,force:true});else report.profile=profile;await new Promise(done=>server.close(done));
  await writeFile(resolve(".ralph/media-framework/model-options-extension.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
