import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";

// Detector evaluation only. No recognized text, ASR accuracy or production
// segmentation is supplied by this test, even when all its gates pass.
const output = resolve(".ralph/media-framework/chrome-vad-build");
const manifest = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
for (const clip of manifest.clips) {
  const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
  assert.equal(bytes.length, clip.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
}
// Exact mixed inputs from the preserved iteration 2 noise evaluation.
const hashes = {
  "quiet-noise": "3f09b111ae02c03ea4f1754b94c2f92eef1d4c8cdd2a479938721752a7d3bb63",
  "white-noise": "579dbcdab93b9f368dd6c93883ac80056751d370c699e69a6612c7af4d7cd7f5",
  hum: "23a7fbefb156e79bb17e598c1a941c56fefc8ed194fc55578f2da4c05363e0b9",
  "ja/speech-quiet-noise": "b4d78bb15c34ec99692f1c5169e80b0cb87d6b1aeb3afaf6551337120d3bb581",
  "ja/speech-white-noise": "38db530ee1d6884d13ed97b716f2ccc690317cf166268163bf5a4591838514e9",
  "en/speech-quiet-noise": "cfb1608b69d1fa5e58467bc1df86271727eff0d649bc123426e1001ddc6fcb67",
  "en/speech-white-noise": "77a05349854fc95239a3145e8847acad34d05315b3d5eb984475932ffddb8864",
};
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: resolve("tests/fixtures/browser-vad-worker.ts"),
    output: { entryFileNames: "worker.js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare" type="button">Prepare detector</button><script type="module">
      globalThis.visibilityEvents = [];
      document.addEventListener('visibilitychange', () => visibilityEvents.push(document.visibilityState));
      globalThis.invoke = (message, transfers = []) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { worker.terminate(); reject(new Error('VAD operation timed out')); }, 120000);
        worker.onmessage = event => {
          clearTimeout(timeout);
          event.data.type === 'error' ? reject(new Error(event.data.message)) : resolve(event.data);
        };
        worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
        worker.postMessage(message, transfers);
      });
      globalThis.prepare = () => {
        globalThis.worker?.terminate(); globalThis.prepared = false; globalThis.prepareError = undefined;
        globalThis.worker = new Worker('/worker.js', {type:'module'});
        invoke({type:'prepare'}).then(value => { globalThis.preparation = value; globalThis.prepared = true; },
          error => { globalThis.prepareError = error.message; });
      };
      document.querySelector('button').onclick = prepare;
      globalThis.readClip = async clip => {
        const decode = new AudioContext();
        try {
          const decoded = await decode.decodeAudioData(await (await fetch('/'+clip.language+'.webm')).arrayBuffer());
          const render = new OfflineAudioContext(1, Math.round(clip.speechDurationSeconds*16000), 16000);
          const source = render.createBufferSource(); source.buffer = decoded;
          source.connect(render.destination); source.start();
          return (await render.startRendering()).getChannelData(0).slice();
        } finally { await decode.close(); }
      };
    </script>`); return;
  }
  const fixture = manifest.clips.find(clip => path === `/${clip.language}.webm`);
  const file = fixture ? resolve(`tests/fixtures/video-speech/${fixture.language}.webm`) : resolve(output, `.${path}`);
  if (!fixture && !file.startsWith(output + sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".webm": "video/webm" })[extname(file)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const observations = { scope: "B2 isolated learned VAD candidate; actual WASM on unchanged paced decoded synthetic noise inputs, no ASR or translation", runs: [], failures: [] };
const execute = promisify(execFile);
let browser; let browserProcess; let browserExit; let profile; let page; let monitor;
let peakRssKiB = 0;
async function sampleRss() {
  const { stdout } = await execute("ps", ["-axo", "pid=,ppid=,rss="]);
  const processes = stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([browserProcess.pid]);
  for (let added = true; added;) {
    added = false;
    for (const [pid, parent] of processes) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); added = true; }
  }
  const rss = processes.filter(([pid]) => owned.has(pid)).reduce((sum, [, , memory]) => sum + memory, 0);
  peakRssKiB = Math.max(peakRssKiB, rss); return rss;
}
try {
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-vad-profile-"));
  browserProcess = spawn(chromium.executablePath(), ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  browserExit = new Promise(done => { browserProcess.once("exit", done); browserProcess.once("error", done); });
  let port; const deadline = performance.now() + 10000;
  while (performance.now() < deadline && browserProcess.exitCode === null) {
    try { port = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert.ok(port, "Owned Chromium must expose its local debugging endpoint");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  observations.browser = browser.version(); observations.platform = `${process.platform}/${process.arch}`;
  observations.memoryMetric = "Owned browser-tree RSS KiB sampled every 250ms; includes shared pages/allocators/browser/GPU process; not isolated model allocations, leak or pressure evidence";
  page = browser.contexts()[0].pages()[0];
  const context = page.context(); const pageErrors = []; const remotePaths = new Set(); const remoteRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  context.on("request", request => { if (request.url().startsWith("https://")) {
    const url = new URL(request.url()); const path = url.origin + url.pathname;
    remotePaths.add(path); remoteRequests.push(path);
  } });
  await page.goto(origin); await page.waitForFunction(() => globalThis.prepare);
  observations.baselineRssKiB = await sampleRss();
  monitor = setInterval(() => { void sampleRss().catch(() => {}); }, 250);
  await page.locator("#prepare").focus(); await page.locator("#prepare").press("Enter");
  await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 120000, polling: 100 });
  assert.equal(await page.evaluate(() => globalThis.prepareError), undefined);
  observations.preparation = await page.evaluate(() => preparation);
  assert.equal(observations.preparation.cached, false);
  assert.deepEqual(observations.preparation.inputNames, ["input", "state", "sr"]);
  assert.deepEqual(observations.preparation.outputNames, ["output", "stateN"]);
  for (const clip of manifest.clips) for (const mode of ["quiet-noise", "white-noise", "hum", "speech-quiet-noise", "speech-white-noise"]) {
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    const run = { language: clip.language, mode, baselineRssKiB: await sampleRss() };
    observations.runs.push(run); peakRssKiB = run.baselineRssKiB;
    const measured = await page.evaluate(async ({ clip, mode }) => {
      const speech = mode.startsWith('speech-');
      const noiseRms = mode.includes('quiet') ? 0.006 : mode === 'hum' ? 0.04 : 0.02;
      const original = speech ? await readClip(clip) : new Float32Array(0);
      const periodSamples = Math.ceil(original.length/320)*320 + 12800;
      const pcm = new Float32Array(speech ? 9600 + periodSamples*3 : 96000);
      if (speech) for (let repeat = 0; repeat < 3; repeat++) pcm.set(original, 9600 + repeat*periodSamples);
      let seed = 0x12345678; let noiseEnergy = 0; let peak = 0;
      for (let i = 0; i < pcm.length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const noise = mode === 'hum' ? Math.SQRT2*noiseRms*Math.sin(2*Math.PI*120*i/16000)
          : ((seed >>> 0)/4294967296*2-1)*Math.sqrt(3)*noiseRms;
        noiseEnergy += noise*noise; pcm[i] += noise; peak = Math.max(peak, Math.abs(pcm[i]));
      }
      if (peak > 1) throw new Error('Noise fixture would clip');
      const inputSamples = pcm.length;
      const inputSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pcm.buffer))]
        .map(byte => byte.toString(16).padStart(2,'0')).join('');
      const result = await invoke({type:'evaluate', pcm}, [pcm.buffer]);
      if (pcm.byteLength !== 0) throw new Error('VAD must receive exclusively transferred PCM');
      return { ...result, sourceSha256:inputSha256, sourceSamples:inputSamples, originalSamples:original.length,
        periodSamples, noiseRms:Math.sqrt(noiseEnergy/inputSamples), peak };
    }, { clip, mode });
    Object.assign(run, measured, { peakRssKiB, finalRssKiB: await sampleRss() });
    const fail = message => observations.failures.push(`${clip.language}/${mode}: ${message}`);
    assert.equal(run.type, "result");
    assert.equal(run.inputSamples, run.sourceSamples);
    assert.equal(run.inputSha256, run.sourceSha256);
    assert.equal(run.inputSha256, hashes[`${clip.language}/${mode}`] ?? hashes[mode], "VAD must evaluate the unchanged iteration 2 input");
    assert.equal(run.frames.length, Math.ceil(run.inputSamples / 512));
    assert.equal(run.paddingSamples, run.frames.length * 512 - run.inputSamples);
    let covered = 0;
    for (const frame of run.frames) {
      assert.equal(frame.startSample, covered); covered += frame.samples;
      assert.ok(frame.samples > 0 && frame.samples <= 512);
      assert.ok(Number.isFinite(frame.probability) && frame.probability >= 0 && frame.probability <= 1);
      assert.ok(frame.atMs >= covered / 16 - 2, "Actual inference must follow paced frame delivery");
    }
    assert.equal(covered, run.inputSamples);
    run.inferenceTotalMs = run.frames.reduce((sum, frame) => sum + frame.inferenceMs, 0);
    run.inferenceMaxMs = Math.max(...run.frames.map(frame => frame.inferenceMs));
    run.maxProbability = Math.max(...run.frames.map(frame => frame.probability));
    run.activeFrames = run.frames.filter(frame => frame.probability >= 0.5).length;
    run.maxDeliveryLagMs = Math.max(...run.frames.map(frame => frame.atMs - (frame.startSample + frame.samples) / 16));
    if (run.inferenceTotalMs >= run.inputSamples / 16 * 0.1) fail("WASM detector total inference must use less than 10% of input duration");
    if (mode.startsWith("speech-")) {
      // A presence gate, not a recall/word-boundary label: each known complete
      // period needs >=250ms of detected activity, with fixed upstream 0.5.
      run.periodActivityMs = Array.from({ length: 3 }, (_, repeat) => {
        const start = 9600 + repeat * run.periodSamples; const end = start + run.originalSamples;
        return run.frames.filter(frame => frame.probability >= 0.5)
          .reduce((sum, frame) => sum + Math.max(0, Math.min(end, frame.startSample + frame.samples) - Math.max(start, frame.startSample)) / 16, 0);
      });
      if (run.periodActivityMs.some(ms => ms < 250)) fail("Each unchanged speech period must contain at least 250ms of detected activity");
    } else if (run.activeFrames) fail("Known speech-free input must have zero frames at or above 0.5");
    console.log(JSON.stringify({ run }));
  }
  // A fresh evaluation worker must load exactly the cached bytes offline.
  const beforeOffline = remoteRequests.length;
  await context.setOffline(true);
  await page.locator("#prepare").focus(); await page.locator("#prepare").press("Enter");
  await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 120000, polling: 100 });
  assert.equal(await page.evaluate(() => globalThis.prepareError), undefined);
  observations.offlinePreparation = await page.evaluate(() => preparation);
  assert.equal(observations.offlinePreparation.cached, true);
  const offline = await page.evaluate(async () => {
    const pcm = new Float32Array(16000);
    return invoke({type:'evaluate', pcm}, [pcm.buffer]);
  });
  observations.offlineControl = offline;
  assert.equal(offline.inputSamples, 16000); assert.equal(offline.frames.length, 32);
  assert.ok(offline.frames.every(frame => frame.probability < 0.5));
  observations.offlineRemoteRequests = remoteRequests.length - beforeOffline;
  assert.equal(observations.offlineRemoteRequests, 0);
  for (const mode of ["quiet-noise", "white-noise", "hum"]) {
    const controls = observations.runs.filter(run => run.mode === mode);
    assert.deepEqual(controls[0].frames.map(frame => frame.probability), controls[1].frames.map(frame => frame.probability),
      "Independent identical controls must reset recurrent state after intervening speech");
  }
  observations.pageErrors = pageErrors; observations.visibilityEvents = await page.evaluate(() => visibilityEvents);
  assert.deepEqual(pageErrors, []); assert.deepEqual(observations.visibilityEvents, []);
  observations.remotePaths = [...remotePaths];
  const pinned = "https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx";
  assert.ok(remotePaths.has(pinned));
  assert.ok([...remotePaths].every(path => path === pinned
    || path.startsWith("https://huggingface.co/api/resolve-cache/models/onnx-community/silero-vad/e71cae966052b992a7eca6b17738916ce0eca4ec/")
    || path.startsWith("https://us.aws.cdn.hf.co/xet-bridge-us/")), "Only pinned model artifacts/redirects may be remote");
  console.log(JSON.stringify({ passed: observations.failures.length === 0, ...observations }));
  assert.deepEqual(observations.failures, [], "Learned VAD must reject known speech-free signals and detect activity in every speech period");
} catch (error) {
  observations.documentState = await page?.evaluate(() => ({ visibility: document.visibilityState, visibilityEvents,
    prepared: globalThis.prepared, prepareError: globalThis.prepareError })).catch(failure => ({ error: failure.message }));
  console.error(JSON.stringify({ passed: false, ...observations, error: error.message })); throw error;
} finally {
  clearInterval(monitor);
  await browser?.close(); browserProcess?.kill("SIGTERM"); await browserExit;
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
