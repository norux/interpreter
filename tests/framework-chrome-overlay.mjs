// Owned extension transport + real video layout/fullscreen. Caption revisions
// are explicitly synthetic: no PCM, ASR, native translation or accuracy claim.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-overlay-build");
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: { outDir: output } });
await build({ configFile: false, logLevel: "warn", build: { outDir: output, emptyOutDir: false,
  rollupOptions: { input: { "overlay-channel": resolve("apps/chrome/overlay-channel.ts"), channel: resolve("apps/chrome/channel.ts") }, preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } } } });
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, "utf8"));
assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "tabCapture"]); assert.equal(manifest.host_permissions, undefined);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path.endsWith(".webm")) { response.setHeader("Content-Type", "video/webm"); response.end(await readFile(`tests/fixtures/video-speech${path}`)); return; }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><meta charset="utf-8"><title>Selected overlay fixture</title><style>
      #player {width:320px} #player:fullscreen {width:100vw;background:black} #player:fullscreen video {width:100%;height:80vh}
      video {width:320px;height:180px} body {height:1800px} </style>
      <div id="player"><video id="ja" title="Japanese fixture" src="/ja.webm" controls></video>
      <button id="containerFullscreen">Fullscreen player</button><button id="videoFullscreen">Fullscreen video</button></div>
      <video id="en" title="English fixture" src="/en.webm" controls></video>
      <script>containerFullscreen.onclick=()=>player.requestFullscreen();videoFullscreen.onclick=()=>ja.requestFullscreen();</script>`);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
// Explicit localhost permission in the ignored test copy only; this is not
// evidence of the shipping toolbar's activeTab grant and is no user-profile bypass.
manifest.host_permissions = [`${origin}/*`]; await writeFile(`${output}/manifest.json`, JSON.stringify(manifest));
const profile = await mkdtemp(resolve(".ralph/media-framework/chrome-overlay-profile-"));
let context;
const observations = { scope: "B4 synthetic accepted-caption revisions over real extension ports and video overlay DOM; no ASR/translation/PCM acceptance",
  pageErrors: [], checks: [], toolbarActiveTabGrant: "unverified" };
try {
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false,
    ignoreDefaultArgs: ["--disable-extensions"], args: [`--disable-extensions-except=${output}`, `--load-extension=${output}`] });
  observations.browser = context.browser().version(); observations.platform = `${process.platform}/${process.arch}`;
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage(); page.on("pageerror", error => observations.pageErrors.push(error.message));
  await page.goto(origin); await page.waitForFunction(() => ja.readyState >= 2 && en.readyState >= 2);
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/`).id, origin);
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"] }), tabId);
  const host = await context.newPage(); host.on("pageerror", error => observations.pageErrors.push(error.message));
  await host.goto(`chrome-extension://${extensionId}/host.html?tab=${tabId}`);
  await host.waitForFunction(() => document.querySelector('#video').options.length === 3);
  assert.match(await host.locator("#fullscreen-support").textContent(), /Video-only fullscreen hides page captions/);
  await host.evaluate(async tabId => {
    const { createRemoteVideoOutput, overlayChannelName } = await import('./overlay-channel.js');
    globalThis.failures = [];
    globalThis.display = createRemoteVideoOutput(chrome.tabs.connect(tabId, {name:overlayChannelName,frameId:0}), error => failures.push(error));
  }, tabId);
  await host.waitForFunction(() => document.querySelector('#connection').textContent.includes('overlay disconnected'));
  assert.equal(await host.locator('#video').isDisabled(), true, 'A lost overlay requires reopening the host before another selection');
  assert.equal(await host.locator('#confirm').isDisabled(), true);
  assert.equal(await host.locator('#language').isDisabled(), true);
  // Obtain opaque target/document identity through the actual catalog channel,
  // without opening audio or preparing engines.
  await host.evaluate(async tabId => {
    const { createRemoteVideoInput, channelName } = await import('./channel.js');
    globalThis.remote = createRemoteVideoInput(chrome.tabs.connect(tabId, {name:channelName,frameId:0}));
    globalThis.targets = await remote.discover(); globalThis.target = targets[0].target;
    globalThis.identity = {sessionId:'overlay-synthetic',targetId:target.id,epoch:0};
    globalThis.source = {identity,utteranceId:'caption',sourceRevision:1,text:'<img src=x onerror=alert(1)> synthetic original',final:false,
      language:'ja',audioRange:{startMs:0,endMs:1000}};
    globalThis.sendPending = () => display.compare({source,translation:{state:'pending'},videoRange:{startMs:12000,endMs:13000}});
    globalThis.sendPair = (text,revision=1) => display.compare({source,translation:{state:'paired',revision:{identity,utteranceId:source.utteranceId,
      sourceRevision:source.sourceRevision,translationRevision:revision,languages:{source:'ja',target:'ko'},text,final:source.final}}});
    display.activate(target,identity);sendPending();
  }, tabId);
  const cue = page.locator('[data-interpreter-overlay] .interpreter-live span').first();
  await cue.waitFor(); await page.waitForFunction(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span').textContent.includes('synthetic'));
  assert.equal(await page.locator('[data-interpreter-overlay] img').count(), 0);
  const geometry = await page.evaluate(() => {const a=ja.getBoundingClientRect(),b=document.querySelector('[data-interpreter-overlay]').getBoundingClientRect();return {video:{left:a.left,top:a.top,width:a.width,height:a.height},overlay:{left:b.left,top:b.top,width:b.width,height:b.height}}});
  assert.deepEqual(geometry.video, geometry.overlay); observations.geometry = geometry;
  await page.evaluate(() => {ja.style.width='280px';window.scrollTo(0,40)});
  await page.waitForFunction(() => {
    const a=ja.getBoundingClientRect(),b=document.querySelector('[data-interpreter-overlay]').getBoundingClientRect();
    return a.width===280 && a.left===b.left && a.top===b.top && a.width===b.width && a.height===b.height;
  });
  await page.evaluate(() => {ja.style.width='320px';window.scrollTo(0,0)});
  await page.waitForFunction(() => document.querySelector('[data-interpreter-overlay]').getBoundingClientRect().width===320);
  observations.checks.push('Owned overlay follows selected-video resize and page scroll without changing the video element');
  await host.evaluate(() => sendPair('합성 번역 결과')); await page.waitForFunction(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span').textContent==='합성 번역 결과');
  await host.evaluate(() => { source={...source,sourceRevision:2,final:true};sendPending();sendPair('긴 최종 번역 '.repeat(80),2); });
  await page.waitForFunction(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span').textContent.startsWith('긴 최종'));
  const initial = await cue.textContent(); assert.ok(initial.length > 0 && initial.length < '긴 최종 번역 '.repeat(80).trim().length);
  await page.waitForFunction(initial => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span').textContent !== initial, initial, {timeout:7500});
  const next = await cue.textContent(); assert.equal(initial+next, '긴 최종 번역 '.repeat(80).trim().slice(0, initial.length+next.length));
  observations.parts = {first:initial.length,second:next.length};
  observations.checks.push('Selected-video geometry, safe original-first text, exact paired revisions, measured two-line sequential final replay');
  await page.bringToFront();
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
  assert.equal(await page.evaluate(() => document.fullscreenEnabled), true);
  await page.getByRole('button',{name:'Fullscreen player',exact:true}).click();
  await page.waitForFunction(() => document.fullscreenElement?.id==='player' && document.querySelector('[data-interpreter-overlay]').parentElement===player);
  assert.equal(await page.locator('[data-interpreter-overlay]').evaluate(node=>getComputedStyle(node).display), 'flex');
  await page.evaluate(() => document.exitFullscreen()); await page.waitForFunction(() => !document.fullscreenElement);
  await page.getByRole('button',{name:'Fullscreen video',exact:true}).click(); await page.waitForFunction(() => document.fullscreenElement===ja && getComputedStyle(document.querySelector('[data-interpreter-overlay]')).display==='none', undefined, {timeout:5000});
  assert.equal(await page.locator('[data-interpreter-overlay]').evaluate(node=>getComputedStyle(node).display), 'none');
  await page.evaluate(() => document.exitFullscreen()); await page.waitForFunction(() => !document.fullscreenElement);
  await host.evaluate(() => display.clear(identity)); await page.locator('[data-interpreter-overlay]').waitFor({state:'detached'});
  await host.evaluate(() => sendPair('late after Stop',3)); assert.equal(await page.locator('[data-interpreter-overlay]').count(),0);
  observations.checks.push('Container fullscreen moves owned overlay inside its surface; video-only fullscreen explicitly hides it; Stop removes overlay and blocks late results');
  await host.evaluate(() => {identity={...identity,sessionId:'restart'};source={...source,identity,sourceRevision:1};display.activate(target,identity);sendPending()});
  await cue.waitFor();
  await page.evaluate(() => ja.remove()); await page.locator('[data-interpreter-overlay]').waitFor({state:'detached'});
  await host.waitForFunction(() => failures.length===1); assert.match(await host.evaluate(() => failures[0]),/context-destroyed/);
  assert.equal(await page.locator('[data-interpreter-overlay]').count(),0); assert.equal(await page.locator('#en').count(),1);
  observations.checks.push('Restart and selected element invalidation remove resources, fail visibly, and never switch to the other video');
  assert.deepEqual(observations.pageErrors,[]);
  console.log(JSON.stringify({passed:true,...observations}));
} catch(error) { console.error(JSON.stringify({passed:false,...observations,error:error.stack}));process.exitCode=1; }
finally {await context?.close();await rm(profile,{recursive:true,force:true});await new Promise(done=>server.close(done));}
