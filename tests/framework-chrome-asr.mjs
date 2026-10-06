import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-asr-build");
const manifest = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
for (const clip of manifest.clips) {
  const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
  assert.equal(bytes.length, clip.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
}
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: { asr: resolve("packages/engines-browser/asr-host.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare">Prepare</button><script type="module">
      import {createAsrHost} from '/asr.js';
      const NativeWorker = Worker; globalThis.ownedWorkers = [];
      globalThis.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); ownedWorkers.push(this); }
      };
      globalThis.makeHost = (candidate, device) => {
        globalThis.statuses = []; globalThis.prepared = false; globalThis.prepareError = undefined;
        globalThis.host = createAsrHost(document, candidate, device, status => statuses.push(status));
      };
      document.querySelector('button').onclick = () => {
        host.prepare().then(() => {globalThis.prepared = true}, error => {globalThis.prepareError = error.message});
      };
      globalThis.readClip = async (clip) => {
        const decode = new AudioContext();
        try {
          const decoded = await decode.decodeAudioData(await (await fetch('/'+clip.language+'.webm')).arrayBuffer());
          const render = new OfflineAudioContext(1, Math.round(clip.speechDurationSeconds * 16000), 16000);
          const source = render.createBufferSource(); source.buffer = decoded; source.connect(render.destination); source.start();
          return (await render.startRendering()).getChannelData(0).slice();
        } finally { await decode.close(); }
      };
      globalThis.job = async (clip) => {
        const pcm = await readClip(clip);
        return {identity: {sessionId: 'fixture-asr', targetId: 'fixture-'+clip.language, epoch: 3}, utteranceId: clip.language+'-one',
          audioRange: {startMs: 0, endMs: pcm.length / 16}, language: clip.language, pcm};
      };
    </script>`); return;
  }
  const fixture = manifest.clips.find(clip => path === `/${clip.language}.webm`);
  const file = fixture ? resolve(`tests/fixtures/video-speech/${fixture.language}.webm`) : resolve(output, `.${path}`);
  if (!fixture && !file.startsWith(output + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const body = await readFile(file);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".webm": "video/webm" })[extname(file)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable"); response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const observations = { scope: "B2 bounded utterance ASR only; decoded synthetic video speech, not selected-video capture/translation/DOM", runs: [], checks: [] };
let browser; let browserProcess; let browserExit; let profile; let monitor;
let peakRssKiB = 0;
const execute = promisify(execFile);
async function sampleRss() {
  // Sum RSS only for this test browser's process tree. Shared pages can be counted
  // twice; this is a process-footprint diagnostic, not GPU allocation or JS heap.
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
function errors(reference, hypothesis, language) {
  const normalize = text => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
  const ref = language === "ja" ? [...normalize(reference).replace(/ /g, "")] : normalize(reference).split(" ");
  const hyp = language === "ja" ? [...normalize(hypothesis).replace(/ /g, "")] : normalize(hypothesis).split(" ");
  let previous = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    previous = row;
  }
  return { metric: language === "ja" ? "CER" : "WER", edits: previous[hyp.length], referenceUnits: ref.length, rate: previous[hyp.length] / ref.length };
}
try {
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-asr-profile-"));
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
  observations.memoryMetric = "Owned Chromium process-tree sum RSS KiB sampled every 250ms; includes shared pages/browser/GPU process, not allocation or physical GPU memory";
  const context = browser.contexts()[0]; const page = context.pages()[0]; page.setDefaultTimeout(10000);
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const remotePaths = new Set();
  page.on("request", request => { if (request.url().startsWith("https://")) { const url = new URL(request.url()); remotePaths.add(url.origin + url.pathname); } });
  monitor = setInterval(() => { void sampleRss().catch(() => {}); }, 250);
  await page.goto(origin); await page.waitForFunction(() => globalThis.makeHost);
  observations.baselineRssKiB = await sampleRss();
  // Each worker is owned by this fixture. Instrument actual GPU device creation
  // so the test can destroy that exact runtime device, never a user's device.
  let latestWorker; let instrumentation;
  page.on("worker", worker => {
    latestWorker = worker;
    instrumentation = worker.evaluate(() => {
      if (typeof GPUAdapter === "undefined") return "no GPUAdapter";
      const original = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await original.apply(this, args); globalThis.testRuntimeDevice = device; return device;
      };
      return "actual device interception installed";
    }).catch(error => error.message);
  });
  const failures = [];
  for (const candidate of ["tiny", "base", "small"]) {
    for (const device of ["wasm", "webgpu"]) {
      await page.evaluate(([candidate, device]) => { globalThis.host?.dispose(); makeHost(candidate, device); }, [candidate, device]);
      const errorStart = consoleErrors.length;
      const run = { candidate, device, results: [] }; observations.runs.push(run);
      run.baselineRssKiB = await sampleRss(); peakRssKiB = run.baselineRssKiB;
      const begin = performance.now();
      await page.locator("#prepare").click();
      await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 240000 });
      run.preparationMs = performance.now() - begin;
      run.status = await page.evaluate(() => ({ failure: globalThis.prepareError, last: statuses.at(-1), states: [...new Set(statuses.map(status => status.state))] }));
      run.workerInstrumentation = await instrumentation;
      run.consoleErrors = consoleErrors.slice(errorStart);
      if (run.status.failure) { run.peakRssKiB = peakRssKiB; failures.push(`${candidate}/${device}: ${run.status.failure}`); console.log(JSON.stringify({ run })); continue; }
      // Repeat the same preserved utterances to expose timing/output variability.
      // Three trials are repeatability evidence, not sustained-stream percentiles.
      for (const { clip, trial } of manifest.clips.flatMap(clip => [1, 2, 3].map(trial => ({ clip, trial })))) {
        const result = await page.evaluate(async clip => {
          const input = await job(clip); const length = input.pcm.length;
          const started = performance.now(); const output = await host.recognize(input);
          return { ...output, hostRoundTripMs: performance.now() - started, inputSamples: length, transferredBytesAfter: input.pcm.byteLength };
        }, clip);
        const accuracy = errors(clip.text, result.revision.text, clip.language);
        const seconds = result.inputSamples / 16000;
        run.results.push({ language: clip.language, trial, ...result, audioSeconds: seconds, realTimeFactor: result.inferenceMs / (seconds * 1000), accuracy });
        assert.equal(result.transferredBytesAfter, 0);
        assert.deepEqual(result.revision.identity, { sessionId: "fixture-asr", targetId: `fixture-${clip.language}`, epoch: 3 });
        assert.equal(result.revision.sourceRevision, 1); assert.equal(result.revision.final, true); assert.equal(result.revision.language, clip.language);
        assert.equal(result.revision.utteranceId, `${clip.language}-one`); assert.equal(result.revision.audioRange.startMs, 0);
        assert.ok(Math.abs(result.revision.audioRange.endMs - seconds * 1000) < 0.001);
        if (accuracy.rate > 0.2) failures.push(`${candidate}/${device}/${clip.language}/trial-${trial}: ${accuracy.metric} ${accuracy.rate} exceeds preliminary 0.2 comparison gate`);
      }
      run.peakRssKiB = peakRssKiB;
      // A separate listener runs after the browser's microtask checkpoint and
      // can observe only a completed WASM job. Wrap the owned handler instead:
      // acknowledge its real pipeline call before the outer callback returns.
      await latestWorker.evaluate(() => {
        let probePort;
        const original = globalThis.onmessage;
        globalThis.onmessage = function (event) {
          if (event.data?.fixtureAsrProbe) { probePort = event.data.port; return; }
          const result = original.call(this, event);
          if (event.data?.type === "recognize") probePort?.postMessage("pipeline-invoked");
          return result;
        };
      });
      await page.evaluate(async clip => {
        const first = await job(clip); const second = await job(clip);
        const channel = new MessageChannel(); globalThis.probePort = channel.port1;
        globalThis.pipelineInvocationObserved = false;
        channel.port1.onmessage = () => {
          globalThis.pipelineInvocationObserved = true; host.stop(); channel.port1.close();
        };
        ownedWorkers.at(-1).postMessage({ fixtureAsrProbe: true, port: channel.port2 }, [channel.port2]);
        globalThis.activeRecognition = host.recognize(first).then(() => "unexpected result", error => error.message);
        globalThis.overloadResult = await host.recognize(second).then(() => "unexpected accepted", error => error.message);
        globalThis.retainedRejectedSamples = second.pcm.length;
      }, manifest.clips[0]);
      await page.waitForFunction(() => globalThis.pipelineInvocationObserved);
      const cancellation = await page.evaluate(async clip => {
        const stopped = await activeRecognition;
        await new Promise(done => setTimeout(done, 200));
        const after = await host.recognize(await job(clip)).then(() => "unexpected late ready", error => error.message);
        return { overload: overloadResult, stopped, after, retainedRejectedSamples, pipelineInvocationObserved };
      }, manifest.clips[0]);
      assert.equal(cancellation.overload, "overloaded"); assert.equal(cancellation.stopped, "ASR stopped");
      assert.match(cancellation.after, /not ready/); assert.ok(cancellation.retainedRejectedSamples > 0);
      run.cancellation = cancellation;
      await page.evaluate(() => { globalThis.prepared = false; globalThis.prepareError = undefined; });
      await page.locator("#prepare").click();
      await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 120000 });
      assert.equal(await page.evaluate(() => globalThis.prepareError), undefined);
      if (device === "webgpu") {
        run.workerInstrumentation = await instrumentation;
        assert.equal(await latestWorker.evaluate(() => !!globalThis.testRuntimeDevice), true, "Test must destroy the actual runtime device");
        await latestWorker.evaluate(() => globalThis.testRuntimeDevice.destroy());
        await page.waitForTimeout(300);
        const loss = await page.evaluate(async clip => host.recognize(await job(clip)).then(() => "unexpected result", error => error.message), manifest.clips[0]);
        assert.equal(loss, "gpu-lost"); run.gpuLoss = "Actual runtime GPUDevice.destroy(): gpu-lost, worker terminated, no fallback";
      } else {
        const restarted = await page.evaluate(async clip => host.recognize(await job(clip)), manifest.clips[0]);
        assert.ok(restarted.revision.text.trim().length > 0); run.restart = "Fresh cached worker recognizes actual speech after Stop";
      }
      await page.evaluate(() => host.dispose());
      console.log(JSON.stringify({ run }));
    }
  }
  observations.remotePaths = [...remotePaths]; observations.pageErrors = pageErrors; observations.failures = failures;
  assert.ok([...remotePaths].every(path => /^https:\/\/huggingface.co\/(onnx-community\/whisper-(tiny|base|small)\/resolve\/[a-f0-9]{40}\/|api\/resolve-cache\/models\/onnx-community\/whisper-(tiny|base|small)\/[a-f0-9]{40}\/)/.test(path)
    || ["us.aws.cdn.hf.co", "cas-bridge.xethub.hf.co", "cas-server.xethub.hf.co"].includes(new URL(path).hostname)), "Only pinned model artifacts and Hub storage redirects may be fetched");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failures, [], "Comparison gates must pass; no failed candidate is silently removed");
  observations.checks.push("Three trials per language on all three candidates/both backends, preliminary CER/WER <= 0.2", "Transferred bounded PCM and original identity", "Real in-flight Stop, overload admission and fresh-worker restart", "Actual WebGPU device loss stays explicit");
  console.log(JSON.stringify({ passed: true, ...observations }));
} catch (error) { console.error(JSON.stringify({ passed: false, ...observations, error: error.message })); throw error; }
finally {
  clearInterval(monitor);
  await browser?.close(); browserProcess?.kill("SIGTERM"); await browserExit;
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
