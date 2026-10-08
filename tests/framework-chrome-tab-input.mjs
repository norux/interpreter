// B5a input slice: real action-authorized tabCapture in a persistent extension
// document. This does not establish ASR, native translation or production UI.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-tab-input-build");
await build({ configFile: false, root: resolve("tests/fixtures/tab-capture"), logLevel: "warn", build: {
  outDir: output, emptyOutDir: true, rollupOptions: { input: {
    host: resolve("tests/fixtures/tab-capture/host.html"), action: resolve("tests/fixtures/tab-capture/action.ts"),
    observer: resolve("tests/fixtures/tab-capture/output.html"),
  }, output: { entryFileNames: "[name].js" } },
} });
const production = JSON.parse(await readFile("apps/chrome/public/manifest.json", "utf8"));
const permissions = [...production.permissions, "tabCapture"];
await writeFile(`${output}/manifest.json`, JSON.stringify({ ...production, permissions,
  background: { service_worker: "action.js", type: "module" } }));
await writeFile(`${output}/pcm-worklet.js`, await readFile("packages/media-web/pcm-worklet.js"));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/ja.webm") {
    const bytes = await readFile("tests/fixtures/video-speech/ja.webm");
    response.setHeader("Content-Type", "video/webm"); response.end(bytes); return;
  }
  const mode = url.searchParams.get("mode") ?? "audio";
  const frequency = mode === "other" ? 11000 : mode === "iframe" ? 660 : 440;
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><title>Tab source ${mode}</title>
    ${mode === "video" ? '<video src="/ja.webm" controls loop></video>' : ''}
    ${mode === "audio-element" ? '<audio src="/ja.webm" controls loop></audio>' : ''}
    ${mode === "mix" ? `<iframe src="http://localhost:${server.address().port}/?mode=iframe"></iframe>` : ''}
    ${mode === "iframe-video" ? `<iframe src="http://localhost:${server.address().port}/?mode=video"></iframe>` : ''}
    <button>Play</button><script>
    document.querySelector('button').onclick=async()=>{
      if(document.querySelector('video,audio')){await document.querySelector('video,audio').play()}
      else if(!document.querySelector('iframe') || ${mode === "mix"}) {globalThis.audio=new AudioContext();const oscillator=audio.createOscillator();oscillator.frequency.value=${frequency};
        const gain=audio.createGain();gain.gain.value=0.1;oscillator.connect(gain).connect(audio.destination);oscillator.start();await audio.resume()}
      globalThis.playing=true;
    };</script>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const profile = await mkdtemp(resolve(".ralph/media-framework/chrome-tab-input-profile-"));
let context;
const observations = { scope: "B5a real tab input/playback/lifecycle slice; test action/host, production UI and ASR/translation unverified", permissions, pageErrors: [], runs: [] };
function amplitude(samples, rate, frequency) {
  let sin = 0, cos = 0, weight = 0;
  for (let i = 0; i < samples.length; i++) {
    const taper = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (samples.length - 1));
    const phase = 2 * Math.PI * frequency * i / rate;
    sin += samples[i] * taper * Math.sin(phase); cos += samples[i] * taper * Math.cos(phase); weight += taper;
  }
  return 2 * Math.hypot(sin, cos) / weight;
}
try {
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false,
    ignoreDefaultArgs: ["--disable-extensions", "--mute-audio"], args: [`--disable-extensions-except=${output}`, `--load-extension=${output}`,
      "--enable-unsafe-extension-debugging", "--auto-select-tab-capture-source-by-title=Output under test", "--enable-usermedia-screen-capturing"] });
  observations.browser = context.browser().version(); observations.platform = `${process.platform}/${process.arch}`;
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const cdp = await context.browser().newBrowserCDPSession();
  const other = await context.newPage();
  await other.goto(`http://127.0.0.1:${server.address().port}/?mode=other`); await other.getByRole("button").click();
  for (const mode of ["audio", "mix", "video", "audio-element", "iframe-video"]) {
    const speech = ["video", "audio-element", "iframe-video"].includes(mode);
    const index = speech ? 3 : 0;
    const outputMarkers = mode === "mix" ? [0,1] : [index];
    const page = await context.newPage(); page.on("pageerror", error => observations.pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
    await page.getByRole("button").click();
    if (["mix", "iframe-video"].includes(mode)) await page.frames()[1].getByRole("button").click();
    const origins = page.frames().map(frame => new URL(frame.url()).origin);
    if (["mix", "iframe-video"].includes(mode)) assert.notEqual(origins[0],origins[1],"The iframe fixture must actually be cross-origin");
    const topMedia = await page.evaluate(() => ({video:document.querySelectorAll('video').length,audio:document.querySelectorAll('audio').length}));
    assert.equal(topMedia.video,mode === 'video' ? 1 : 0);
    assert.equal(topMedia.audio,mode === 'audio-element' ? 1 : 0);
    const mediaFrame = mode === "iframe-video" ? page.frames()[1] : page.mainFrame();
    const mediaProperties = () => mediaFrame.evaluate(() => [...document.querySelectorAll('video,audio')].map(media => ({
      src:media.getAttribute('src'),crossOrigin:media.crossOrigin,volume:media.volume,muted:media.muted,paused:media.paused,loop:media.loop,
    })));
    const originalProperties = await mediaProperties();
    await page.bringToFront();
    const tab = await worker.evaluate(async () => (await chrome.tabs.query({active:true,currentWindow:true}))[0]);
    const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] });
    const target = targetInfos.find(info => info.url === page.url()); assert.ok(target);
    const opened = context.waitForEvent("page");
    await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
    const host = await opened; host.on("pageerror", error => observations.pageErrors.push(error.message));
    await host.waitForFunction(() => globalThis.captured || globalThis.error);
    assert.equal(await host.evaluate(() => globalThis.error), undefined);
    assert.equal(await host.evaluate(() => globalThis.capture.target.tabId), tab.id);
    await host.evaluate(() => { document.title = 'Output under test'; });
    await host.getByRole("button", {name:"Observe host output"}).click();
    await host.waitForFunction(() => globalThis.outputReady || globalThis.error);
    assert.equal(await host.evaluate(() => globalThis.error), undefined);
    async function outputLevel(surface = host) {
      const rate = await surface.evaluate(() => globalThis.outputContext.sampleRate);
      let values;
      const deadline = performance.now() + 5000;
      do {
        await surface.waitForTimeout(100);
        values = await surface.evaluate(() => globalThis.measure());
      } while (Math.abs(amplitude(values,rate,speech ? 6500 : 440)/(speech ? 0.06 : 0.1)-1) >= 0.03 && performance.now() < deadline);
      const result = [440,660,11000,6500].map(frequency => amplitude(values,rate,frequency));
      for (const marker of outputMarkers) assert.ok(Math.abs(result[marker]/(speech ? 0.06 : 0.1)-1)<0.03, `Native output must match known fixture within 3% ${JSON.stringify(result)}`);
      assert.ok(result[2] < 0.001, `Other-tab audio leaked ${JSON.stringify(result)}`);
      if (mode === "mix") assert.ok(result[1] > 0.08, `Cross-origin iframe output missing ${JSON.stringify(result)}`);
      return result;
    }
    async function restoredOutput(baseline) {
      if (!host.isClosed()) await host.evaluate(() => { document.title = 'Tab input host'; });
      await page.evaluate(() => { document.title = 'Output under test'; });
      const observer = await context.newPage(); observer.on('pageerror', error => observations.pageErrors.push(error.message));
      try {
        await observer.goto(`chrome-extension://${extensionId}/output.html`);
        await observer.getByRole('button').click();
        await observer.waitForFunction(() => globalThis.outputReady || globalThis.error);
        assert.equal(await observer.evaluate(() => globalThis.error),undefined);
        const levels = await outputLevel(observer);
        for (const marker of outputMarkers) assert.ok(Math.abs(levels[marker]/baseline[marker]-1)<0.12, `Restored output must not be missing or doubled ${JSON.stringify({baseline,levels})}`);
        assert.deepEqual(await mediaProperties(),originalProperties);
        return levels;
      } finally {
        await observer.close();
        await page.evaluate(mode => { document.title = `Tab source ${mode}`; },mode);
        if (!host.isClosed()) await host.evaluate(() => { document.title = 'Output under test'; });
      }
    }
    const preparationOutput = await outputLevel();
    const rounds = [];
    for (let round = 0; round < 2; round++) {
      // Reacquisition starts a new native playback route. Establish its output
      // readiness before the separate PCM Start, just as for initial capture.
      const beforeStartOutput = await outputLevel();
      await host.getByRole("button", {name:"Start PCM",exact:true}).click();
      await host.waitForFunction(() => globalThis.chunks.length >= 20 || globalThis.error);
      assert.equal(await host.evaluate(() => globalThis.error), undefined);
      const captured = await host.evaluate(() => globalThis.chunks.map(chunk => ({...chunk,pcm:Array.from(new Float32Array(chunk.pcm))})));
      const first = captured[0]; const samples = captured.flatMap(chunk => chunk.pcm);
      assert.equal(first.scope,"tab-mix"); assert.equal(first.audioRange.startMs,0); assert.equal(first.sequence,0);
      assert.equal(first.identity.targetId, await host.evaluate(() => globalThis.capture.target.id));
      const levels = [440,660,11000,6500].map(frequency => amplitude(samples,first.sampleRate,frequency));
      assert.ok(levels[index] > 0.04, `Missing actual tab PCM ${JSON.stringify(levels)}`);
      assert.ok(levels[2] < 0.001); if(mode === "mix") assert.ok(levels[1] > 0.08);
      for(let i=0;i<captured.length;i++) {
        assert.equal(captured[i].pcm.length,2048); assert.equal(captured[i].sequence,i);
        assert.equal(captured[i].capture.clockId,first.capture.clockId);
        if(i) assert.ok(Math.abs(captured[i].audioRange.startMs-captured[i-1].audioRange.endMs)<0.001);
      }
      const duringOutput = await outputLevel();
      for (const marker of outputMarkers) assert.ok(Math.abs(duringOutput[marker]/preparationOutput[marker]-1)<0.12,`PCM branch must not duplicate native output: ${JSON.stringify({preparationOutput,duringOutput})}`);
      const duplicate = await host.evaluate(async () => {
        try { await globalThis.capture.input.open(globalThis.capture.target,{sessionId:'duplicate',targetId:globalThis.capture.target.id,epoch:0});return 'unexpected success'; }
        catch(error){return error.message}
      }); assert.match(duplicate,/already has an active session/);
      await host.getByRole("button", {name:"Stop capture",exact:true}).click();
      await host.waitForFunction(() => globalThis.captureClosed);
      const count = await host.evaluate(() => globalThis.chunks.length); await host.waitForTimeout(150);
      assert.equal(await host.evaluate(() => globalThis.chunks.length),count);
      await host.waitForFunction(async tabId => !(await chrome.tabCapture.getCapturedTabs()).some(info => info.tabId === tabId && ["pending","active"].includes(info.status)), tab.id, {timeout:5000});
      assert.ok(!(await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(info => info.tabId === tab.id && ["pending","active"].includes(info.status)));
      if (round) assert.notEqual(first.capture.clockId,rounds[0].clockId);
      const restoredSiteOutput = await restoredOutput(preparationOutput);
      rounds.push({identity:first.identity,clockId:first.capture.clockId,pcmLevels:levels,beforeStartOutput,nativeHostOutput:duringOutput,restoredSiteOutput,chunks:captured.length,duplicate});
      if(round === 0) {
        await host.getByRole("button",{name:"Restart capture",exact:true}).click(); await host.waitForFunction(() => globalThis.captured || globalThis.error);
        assert.equal(await host.evaluate(() => globalThis.error),undefined);
      }
    }
    if(mode === "audio") {
      await host.getByRole("button",{name:"Restart capture",exact:true}).click(); await host.waitForFunction(() => globalThis.captured);
      await host.getByRole("button",{name:"Slow consumer",exact:true}).click(); await host.waitForFunction(() => globalThis.slowReady);
      await host.waitForTimeout(400);
      const failure=await host.evaluate(async()=>{try{await globalThis.handle.events[Symbol.asyncIterator]().next();return 'unexpected success'}catch(error){return error.message}});
      assert.match(failure,/audio-gap: Tab input queue overflow/);
      observations.overflow=failure;
      observations.overflowRestoredOutput=await restoredOutput(preparationOutput);
    }
    // Browser destruction, not a mock track event: release the owning document
    // while PCM is live and independently observe the original site's output.
    await host.getByRole("button",{name:"Restart capture",exact:true}).click(); await host.waitForFunction(() => globalThis.captured);
    await host.getByRole("button",{name:"Start PCM",exact:true}).click(); await host.waitForFunction(() => globalThis.chunks.length >= 20);
    await host.close();
    const hostClosureOutput = await restoredOutput(preparationOutput);
    await page.bringToFront();
    const reopened = context.waitForEvent('page');
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});
    const replacement = await reopened; replacement.on('pageerror',error=>observations.pageErrors.push(error.message));
    await replacement.waitForFunction(() => globalThis.captured || globalThis.error);
    assert.equal(await replacement.evaluate(() => globalThis.error),undefined);
    assert.equal(await replacement.evaluate(() => globalThis.capture.target.tabId),tab.id);
    const replacementTarget=await replacement.evaluate(() => globalThis.capture.target.id);
    assert.notEqual(replacementTarget,rounds[0].identity.targetId);
    await page.reload(); await replacement.waitForFunction(() => globalThis.interruptions.some(value=>value.includes('navigated')));
    await replacement.waitForFunction(async tabId => !(await chrome.tabCapture.getCapturedTabs()).some(info => info.tabId === tabId && ["pending","active"].includes(info.status)), tab.id, {timeout:5000});
    const navigationInterruptions = await replacement.evaluate(()=>globalThis.interruptions);
    await replacement.close();
    await page.getByRole('button').click();
    if (['mix','iframe-video'].includes(mode)) await page.frames()[1].getByRole('button').click();
    await page.bringToFront();
    const closing = context.waitForEvent('page');
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});
    const closingHost = await closing; closingHost.on('pageerror',error=>observations.pageErrors.push(error.message));
    await closingHost.waitForFunction(() => globalThis.captured || globalThis.error);
    assert.equal(await closingHost.evaluate(() => globalThis.error),undefined);
    await closingHost.getByRole('button',{name:'Start PCM',exact:true}).click();
    await closingHost.waitForFunction(() => globalThis.chunks.length >= 20 || globalThis.error);
    assert.equal(await closingHost.evaluate(() => globalThis.error),undefined);
    await page.close();
    await closingHost.waitForFunction(() => globalThis.interruptions.some(value=>/closed|ended/.test(value)) && globalThis.captureClosed);
    await closingHost.waitForFunction(async tabId => !(await chrome.tabCapture.getCapturedTabs()).some(info => info.tabId === tabId && ['pending','active'].includes(info.status)), tab.id, {timeout:5000});
    const count = await closingHost.evaluate(() => globalThis.chunks.length); await closingHost.waitForTimeout(150);
    assert.equal(await closingHost.evaluate(() => globalThis.chunks.length),count);
    observations.runs.push({mode,origins,topMedia,originalProperties,preparationOutput,rounds,hostClosureOutput,replacementTarget,navigationInterruptions,
      tabClosureInterruptions:await closingHost.evaluate(()=>globalThis.interruptions),tabClosureChunks:count});
    await closingHost.close();
  }
  assert.deepEqual(observations.pageErrors,[]);
  observations.passed=true;
} catch(error) { observations.passed=false;observations.failure=error.stack;process.exitCode=1; }
finally { console.log(JSON.stringify(observations));await context?.close();await rm(profile,{recursive:true,force:true});await new Promise(done=>server.close(done)); }
