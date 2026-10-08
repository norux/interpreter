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
    ${mode === "mix" ? `<iframe src="http://localhost:${server.address().port}/?mode=iframe"></iframe>` : ''}
    <button>Play</button><script>
    document.querySelector('button').onclick=async()=>{
      if(document.querySelector('video')){await document.querySelector('video').play()}
      else {globalThis.audio=new AudioContext();const oscillator=audio.createOscillator();oscillator.frequency.value=${frequency};
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
      "--enable-unsafe-extension-debugging", "--auto-select-tab-capture-source-by-title=Tab input host", "--enable-usermedia-screen-capturing"] });
  observations.browser = context.browser().version(); observations.platform = `${process.platform}/${process.arch}`;
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const cdp = await context.browser().newBrowserCDPSession();
  const other = await context.newPage();
  await other.goto(`http://127.0.0.1:${server.address().port}/?mode=other`); await other.getByRole("button").click();
  for (const mode of ["audio", "mix", "video"]) {
    const page = await context.newPage(); page.on("pageerror", error => observations.pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
    await page.getByRole("button").click();
    if (mode === "mix") await page.frames()[1].getByRole("button").click();
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
    await host.getByRole("button", {name:"Observe host output"}).click();
    await host.waitForFunction(() => globalThis.outputReady || globalThis.error);
    assert.equal(await host.evaluate(() => globalThis.error), undefined);
    const rate = await host.evaluate(() => globalThis.outputContext.sampleRate);
    async function outputLevel() {
      let values;
      const deadline = performance.now() + 5000;
      do {
        await host.waitForTimeout(100);
        values = await host.evaluate(() => globalThis.measure());
      } while (Math.abs(amplitude(values,rate,mode === "video" ? 6500 : 440)/(mode === "video" ? 0.06 : 0.1)-1) >= 0.03 && performance.now() < deadline);
      const result = [440,660,11000,6500].map(frequency => amplitude(values,rate,frequency));
      assert.ok(result[mode === "video" ? 3 : 0] > 0.04, `Native host output missing ${JSON.stringify(result)}`);
      assert.ok(result[2] < 0.001, `Other-tab audio leaked ${JSON.stringify(result)}`);
      if (mode === "mix") assert.ok(result[1] > 0.08, `Cross-origin iframe output missing ${JSON.stringify(result)}`);
      return result;
    }
    const preparationOutput = await outputLevel();
    const rounds = [];
    for (let round = 0; round < 2; round++) {
      await host.getByRole("button", {name:"Start PCM",exact:true}).click();
      await host.waitForFunction(() => globalThis.chunks.length >= 20 || globalThis.error);
      assert.equal(await host.evaluate(() => globalThis.error), undefined);
      const captured = await host.evaluate(() => globalThis.chunks.map(chunk => ({...chunk,pcm:Array.from(new Float32Array(chunk.pcm))})));
      const first = captured[0]; const samples = captured.flatMap(chunk => chunk.pcm);
      assert.equal(first.scope,"tab-mix"); assert.equal(first.audioRange.startMs,0); assert.equal(first.sequence,0);
      assert.equal(first.identity.targetId, await host.evaluate(() => globalThis.capture.target.id));
      const levels = [440,660,11000,6500].map(frequency => amplitude(samples,first.sampleRate,frequency));
      assert.ok(levels[mode === "video" ? 3 : 0] > 0.04, `Missing actual tab PCM ${JSON.stringify(levels)}`);
      assert.ok(levels[2] < 0.001); if(mode === "mix") assert.ok(levels[1] > 0.08);
      for(let i=0;i<captured.length;i++) {
        assert.equal(captured[i].pcm.length,2048); assert.equal(captured[i].sequence,i);
        assert.equal(captured[i].capture.clockId,first.capture.clockId);
        if(i) assert.ok(Math.abs(captured[i].audioRange.startMs-captured[i-1].audioRange.endMs)<0.001);
      }
      const duringOutput = await outputLevel();
      const index = mode === "video" ? 3 : 0;
      assert.ok(Math.abs(duringOutput[index]/preparationOutput[index]-1)<0.12,`PCM branch must not duplicate native output: ${JSON.stringify({preparationOutput,duringOutput})}`);
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
      rounds.push({identity:first.identity,clockId:first.capture.clockId,pcmLevels:levels,nativeHostOutput:duringOutput,chunks:captured.length,duplicate});
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
    }
    await host.getByRole("button",{name:"Restart capture",exact:true}).click(); await host.waitForFunction(() => globalThis.captured);
    await page.reload(); await host.waitForFunction(() => globalThis.interruptions.some(value=>value.includes('navigated')));
    await host.waitForFunction(async tabId => !(await chrome.tabCapture.getCapturedTabs()).some(info => info.tabId === tabId && ["pending","active"].includes(info.status)), tab.id, {timeout:5000});
      assert.ok(!(await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(info => info.tabId === tab.id && ["pending","active"].includes(info.status)));
    observations.runs.push({mode,preparationOutput,rounds,interruptions:await host.evaluate(()=>globalThis.interruptions)});
    await host.close(); await page.close();
  }
  assert.deepEqual(observations.pageErrors,[]);
  observations.passed=true;
} catch(error) { observations.passed=false;observations.failure=error.stack;process.exitCode=1; }
finally { console.log(JSON.stringify(observations));await context?.close();await rm(profile,{recursive:true,force:true});await new Promise(done=>server.close(done)); }
