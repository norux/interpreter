import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";

// B2 noise qualification only: decoded synthetic speech, not live acquisition,
// natural speakers, translation, caption DOM or full Chrome-stage acceptance.
const output = resolve(".ralph/media-framework/chrome-noise-build");
const manifest = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
for (const clip of manifest.clips) {
  const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
  assert.equal(bytes.length, clip.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
}
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: { asr: resolve("packages/engines-browser/asr-host.ts"),
    speech: resolve("packages/engines-browser/speech-recognizer.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare">Prepare</button><script type="module">
      import {createAsrHost} from '/asr.js';
      import {createSpeechRecognizer} from '/speech.js';
      globalThis.createSpeechRecognizer = createSpeechRecognizer;
      globalThis.visibilityEvents = [];
      document.addEventListener('visibilitychange', () => visibilityEvents.push(document.visibilityState));
      globalThis.prepare = () => {
        globalThis.host?.dispose(); globalThis.modelStatuses = [];
        globalThis.prepared = false; globalThis.prepareError = undefined;
        globalThis.host = createAsrHost(document, 'smallFp16', 'webgpu', status => modelStatuses.push(status));
        host.prepare().then(() => {globalThis.prepared = true}, error => {globalThis.prepareError = error.message});
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
const observations = { scope: "B2 deterministic additive noise and no-speech regression; real FP16 WebGPU ASR over paced decoded synthetic PCM", runs: [], failures: [] };
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
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-noise-profile-"));
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
  observations.memoryMetric = "Owned browser-tree RSS KiB sampled every 250ms, including shared pages/allocators/browser/GPU process; not isolated model allocations, leak or pressure evidence";
  page = browser.contexts()[0].pages()[0];
  const pageErrors = []; const remotePaths = new Set();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { if (request.url().startsWith("https://")) { const url = new URL(request.url()); remotePaths.add(url.origin + url.pathname); } });
  await page.goto(origin); await page.waitForFunction(() => globalThis.prepare);
  observations.baselineRssKiB = await sampleRss();
  monitor = setInterval(() => { void sampleRss().catch(() => {}); }, 250);
  for (const clip of manifest.clips) for (const mode of ["quiet-noise", "white-noise", "hum", "speech-quiet-noise", "speech-white-noise"]) {
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    const run = { language: clip.language, mode, baselineRssKiB: await sampleRss() };
    observations.runs.push(run); peakRssKiB = run.baselineRssKiB;
    const preparationStart = performance.now();
    await page.locator("#prepare").focus(); await page.locator("#prepare").press("Enter");
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 240000, polling: 100 });
    run.preparationMs = performance.now() - preparationStart;
    const status = await page.evaluate(() => ({ error: prepareError, last: modelStatuses.at(-1) }));
    assert.equal(status.error, undefined); assert.equal(status.last.state, "ready"); assert.equal(status.last.requiredBytes, 487960440);
    const measured = await page.evaluate(async ({ clip, mode }) => {
      const speech = mode.startsWith('speech-');
      const noiseRms = mode.includes('quiet') ? 0.006 : mode === 'hum' ? 0.04 : 0.02;
      const original = speech ? await readClip(clip) : new Float32Array(0);
      const periodSamples = Math.ceil(original.length/320)*320 + 12800;
      const pcm = new Float32Array(speech ? 9600 + periodSamples*3 : 96000);
      if (speech) for (let repeat = 0; repeat < 3; repeat++) pcm.set(original, 9600 + repeat*periodSamples);
      let seed = 0x12345678; let noiseEnergy = 0; let speechEnergy = 0; let peak = 0;
      for (let i = 0; i < pcm.length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const noise = mode === 'hum' ? Math.SQRT2*noiseRms*Math.sin(2*Math.PI*120*i/16000)
          : ((seed >>> 0)/4294967296*2-1)*Math.sqrt(3)*noiseRms;
        speechEnergy += pcm[i]*pcm[i]; noiseEnergy += noise*noise;
        pcm[i] += noise; peak = Math.max(peak, Math.abs(pcm[i]));
      }
      // No clipping, filtering, deleted source samples, expected text or padded
      // speech enters inference. Noise and explicit gaps are the new test input.
      if (peak > 1) throw new Error('Noise fixture would clip');
      const digest = async samples => [...new Uint8Array(await crypto.subtle.digest('SHA-256', samples.buffer))]
        .map(byte => byte.toString(16).padStart(2,'0')).join('');
      const inputSha256 = await digest(pcm);
      const identity = {sessionId: 'fixture-noise', targetId: `fixture-${clip.language}`, epoch: 4};
      const statuses = []; const transcripts = []; const invocations = []; const deliveries = [];
      const executor = { stop: () => host.stop(), recognize: async job => {
        const startSample = Math.round(job.audioRange.startMs*16);
        const inputSlice = pcm.slice(startSample, startSample+job.pcm.length);
        const invocation = {audioRange: {...job.audioRange}, samples: job.pcm.length,
          exactInput: job.pcm.every((sample,i) => sample === inputSlice[i]), pcmSha256: await digest(job.pcm)};
        invocations.push(invocation); invocation.atMs = performance.now();
        try { return await host.recognize(job); } finally { invocation.settledAtMs = performance.now(); }
      }};
      const recognizer = createSpeechRecognizer(identity, clip.language, executor, status => statuses.push({...status, atMs: performance.now()}));
      const start = performance.now();
      async function* paced() {
        for (let offset = 0, sequence = 0; offset < pcm.length; offset += 1600, sequence++) {
          const packet = pcm.slice(offset,offset+1600);
          const startMs = offset/16; const endMs = startMs+packet.length/16;
          await new Promise(done => setTimeout(done,Math.max(0,start+endMs-performance.now())));
          deliveries.push({endMs,atMs:performance.now()});
          yield {identity,scope:'selected-video',sequence,audioRange:{startMs,endMs},
            capture:{clockId:'fixture-noise-document',startMs,endMs},sampleRate:16000,channels:1,sampleFormat:'pcm-f32le',pcm:packet.buffer};
        }
      }
      let outcome = 'completed';
      try { for await (const revision of recognizer.run(paced())) transcripts.push({...revision,observedAtMs:performance.now()}); }
      catch (error) { outcome = error.message; }
      return {outcome,originalSamples:original.length,inputSamples:pcm.length,inputDurationMs:pcm.length/16,
        inputSha256,noiseRms:Math.sqrt(noiseEnergy/pcm.length),snrDb:speech ? 10*Math.log10(speechEnergy/noiseEnergy) : undefined,
        peak,hostDurationMs:performance.now()-start,transcripts,invocations,deliveries,statuses};
    }, { clip, mode });
    Object.assign(run, measured, { peakRssKiB, finalRssKiB: await sampleRss() });
    const fail = message => observations.failures.push(`${clip.language}/${mode}: ${message}`);
    if (run.outcome !== "completed") fail(run.outcome);
    assert.equal(run.deliveries.at(-1).endMs, run.inputDurationMs);
    assert.ok(run.hostDurationMs >= run.inputDurationMs-1, "Actual paced delivery must cover the input duration");
    run.maxPendingAudioMs = Math.max(...run.statuses.map(status => status.queue.pendingAudioMs));
    assert.ok(run.maxPendingAudioMs <= 30000); assert.equal(run.statuses.at(-1).queue.pendingAudioMs, 0);
    if (run.statuses.some(status => status.queue.droppedAudioMs !== 0)) fail("discarded audio");
    assert.ok(run.invocations.every(job => job.exactInput), "Actual ASR jobs must equal the corresponding mixed input samples");
    assert.equal(run.invocations.length, run.transcripts.length);
    run.endpointLatenciesMs = run.transcripts.map((revision, i) => {
      assert.deepEqual(revision.identity, { sessionId: "fixture-noise", targetId: `fixture-${clip.language}`, epoch: 4 });
      assert.equal(revision.sourceRevision, 1); assert.equal(revision.final, true); assert.equal(revision.language, clip.language);
      assert.equal(revision.utteranceId, `speech-${i+1}`);
      assert.deepEqual(revision.audioRange, run.invocations[i].audioRange);
      assert.equal(run.invocations[i].samples, Math.round((revision.audioRange.endMs-revision.audioRange.startMs)*16));
      assert.ok(revision.audioRange.endMs-revision.audioRange.startMs <= 20000);
      const delivery = run.deliveries.find(packet => packet.endMs >= revision.audioRange.endMs);
      return revision.observedAtMs-delivery.atMs;
    });
    if (run.endpointLatenciesMs.some(ms => ms < 0 || ms >= 2000)) fail("endpoint-to-text exceeds preserved 2000 ms gate");
    if (mode.startsWith("speech-")) {
      const text = run.transcripts.map(revision => revision.text).join(" ");
      run.accuracy = errors(Array(3).fill(clip.text).join(" "), text, clip.language);
      if (run.accuracy.rate > 0.2) fail(`${run.accuracy.metric} exceeds preserved 20% gate`);
      const normalized = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, clip.language === "ja" ? "" : " ");
      const anchors = clip.language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
        : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
      run.meaningCounts = Object.fromEntries(anchors.map(anchor => [anchor, normalized.split(anchor).length-1]));
      if (Object.values(run.meaningCounts).some(count => count !== 3)) fail("every preserved meaning must occur exactly three times");
      if (mode === "speech-quiet-noise" && run.transcripts.length !== 3) fail("below-gate noisy pauses must retain three endpoints");
      if (mode === "speech-white-noise") {
        assert.equal(run.transcripts[0]?.audioRange.startMs, 0);
        for (let i = 1; i < run.transcripts.length; i++) assert.equal(run.transcripts[i].audioRange.startMs, run.transcripts[i-1].audioRange.endMs);
        assert.equal(run.transcripts.at(-1)?.audioRange.endMs, run.inputDurationMs);
      }
    } else {
      // Empty recognized text is allowed; a model-generated phrase on known
      // speech-free input is a failure even if the queue/accounting passed.
      if (run.transcripts.some(revision => revision.text.trim())) fail("fabricated text on known speech-free input");
      if (mode === "quiet-noise" && run.invocations.length) fail("below-gate noise must make no ASR calls");
    }
    console.log(JSON.stringify({ run }));
  }
  observations.pageErrors = pageErrors;
  observations.visibilityEvents = await page.evaluate(() => visibilityEvents);
  assert.deepEqual(pageErrors, []); assert.deepEqual(observations.visibilityEvents, []);
  observations.remotePaths = [...remotePaths];
  const pinned = "https://huggingface.co/onnx-community/whisper-small/resolve/36050c46d777d46dc4b5f43f6d90574fc38f8732/";
  assert.equal([...remotePaths].filter(path => path.startsWith(pinned)).length, 7);
  assert.ok([...remotePaths].every(path => path.startsWith(pinned)
    || path.startsWith("https://huggingface.co/api/resolve-cache/models/onnx-community/whisper-small/36050c46d777d46dc4b5f43f6d90574fc38f8732/")
    || path.startsWith("https://us.aws.cdn.hf.co/xet-bridge-us/")), "Only pinned model artifacts/redirects may be remote");
  console.log(JSON.stringify({ passed: observations.failures.length === 0, ...observations }));
  assert.deepEqual(observations.failures, [], "Noise qualification must preserve speech meaning and reject fabricated no-speech text");
} catch (error) {
  observations.documentState = await page?.evaluate(() => ({ visibility: document.visibilityState, visibilityEvents,
    prepared: globalThis.prepared, prepareError: globalThis.prepareError, lastStatus: globalThis.modelStatuses?.at(-1) })).catch(failure => ({ error: failure.message }));
  console.error(JSON.stringify({ passed: false, ...observations, error: error.message })); throw error;
} finally {
  clearInterval(monitor);
  await browser?.close(); browserProcess?.kill("SIGTERM"); await browserExit;
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
