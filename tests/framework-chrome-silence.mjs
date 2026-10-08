import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";

// B2 long-silence regression: real VAD/ASR over paced decoded synthetic PCM.
// This does not replace the unchanged noise or full Chrome-stage acceptance.
const output = resolve(".ralph/media-framework/chrome-silence-build");
// Fixed complete mixed inputs from the first independently observed run.
const hashes = {
  ja: "6b1cd4f56f4ac185852ffe7dd526c5ef65e833ded5f69c58f03c6657a1a4099e",
  en: "29e60d64bc9202558dabb542e7518a301fdc2578756baa24723ae7d38b00cc27",
};
const manifest = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
for (const clip of manifest.clips) {
  const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
  assert.equal(bytes.length, clip.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
}
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: { asr: resolve("packages/engines-browser/asr-host.ts"),
    speech: resolve("packages/engines-browser/speech-recognizer.ts"),
    vad: resolve("packages/engines-browser/vad-host.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare">Prepare</button><script type="module">
      import {createAsrHost} from '/asr.js';
      import {createSpeechRecognizer} from '/speech.js';
      import {createVadHost} from '/vad.js';
      globalThis.createSpeechRecognizer = createSpeechRecognizer;
      globalThis.visibilityEvents = [];
      document.addEventListener('visibilitychange', () => visibilityEvents.push(document.visibilityState));
      globalThis.prepare = () => {
        globalThis.host?.dispose(); globalThis.vad?.dispose(); globalThis.modelStatuses = []; globalThis.vadStatuses = [];
        globalThis.prepared = false; globalThis.prepareError = undefined;
        globalThis.host = createAsrHost(document, 'smallFp16', 'webgpu', status => modelStatuses.push(status));
        globalThis.vad = createVadHost(document, status => vadStatuses.push(status));
        Promise.all([host.prepare(), vad.prepare()]).then(() => {globalThis.prepared = true}, error => {globalThis.prepareError = error.message});
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
const observations = { scope: "B2 long detected-silence endpoint; real WASM VAD and FP16 WebGPU ASR over paced decoded synthetic PCM", runs: [], failures: [] };
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
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-silence-profile-"));
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
  page.context().on("request", request => { if (request.url().startsWith("https://")) { const url = new URL(request.url()); remotePaths.add(url.origin + url.pathname); } });
  await page.goto(origin); await page.waitForFunction(() => globalThis.prepare);
  observations.baselineRssKiB = await sampleRss();
  monitor = setInterval(() => { void sampleRss().catch(() => {}); }, 250);
  for (const clip of manifest.clips) {
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    const run = { language: clip.language, baselineRssKiB: await sampleRss() };
    observations.runs.push(run); peakRssKiB = run.baselineRssKiB;
    const preparationStart = performance.now();
    await page.locator("#prepare").focus(); await page.locator("#prepare").press("Enter");
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 240000, polling: 100 });
    run.preparationMs = performance.now() - preparationStart;
    const status = await page.evaluate(() => ({ error: prepareError, last: modelStatuses.at(-1), vadStatuses }));
    assert.equal(status.error, undefined); assert.equal(status.last.state, "ready");
    assert.equal(status.last.requiredBytes, 487960440);
    assert.equal(status.vadStatuses.at(-1).state, "ready");
    assert.equal(status.vadStatuses.at(-1).requiredBytes, 2243022);
    const measured = await page.evaluate(async clip => {
      const original = await readClip(clip);
      const periodSamples = Math.ceil(original.length/512)*512 + 80000;
      const pcm = new Float32Array(9600 + periodSamples*2);
      for (let repeat = 0; repeat < 2; repeat++) pcm.set(original, 9600 + repeat*periodSamples);
      let seed = 0x12345678;
      for (let i = 0; i < pcm.length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pcm[i] += ((seed >>> 0)/4294967296*2-1)*Math.sqrt(3)*0.006;
      }
      const digest = async samples => [...new Uint8Array(await crypto.subtle.digest('SHA-256', samples.buffer))]
        .map(byte => byte.toString(16).padStart(2,'0')).join('');
      const identity = {sessionId:'fixture-silence', targetId:`fixture-${clip.language}`, epoch:6};
      const statuses = []; const transcripts = []; const invocations = []; const deliveries = []; const frames = [];
      let deliveredSamples = 0; let detectorSamples = 0; let ended = false;
      const executor = {stop: () => host.stop(), recognize: async job => {
        const offset = Math.round(job.audioRange.startMs*16);
        const invocation = {audioRange:job.audioRange, samples:job.pcm.length,
          exactInput:job.pcm.every((sample,i) => sample === pcm[offset+i]),
          pcmSha256:await digest(job.pcm), atMs:performance.now(), deliveredSamples, ended};
        invocations.push(invocation);
        try { return await host.recognize(job); } finally { invocation.settledAtMs = performance.now(); }
      }};
      const detector = {stop: () => vad.stop(), detect: async frame => {
        const snapshot = frame.slice(); const result = await vad.detect(frame);
        if (!frame.every((sample,i) => sample === snapshot[i])) throw new Error('Detector altered ASR PCM');
        frames.push({...result, startSample:detectorSamples, atMs:performance.now()});
        detectorSamples += frame.length; return result;
      }};
      const recognizer = createSpeechRecognizer(identity, clip.language, executor,
        status => statuses.push({...status,atMs:performance.now()}), detector);
      const start = performance.now();
      async function* paced() {
        for (let offset = 0, sequence = 0; offset < pcm.length; offset += 1600, sequence++) {
          const packet = pcm.slice(offset, offset+1600);
          const startMs = offset/16; const endMs = startMs+packet.length/16;
          await new Promise(done => setTimeout(done, Math.max(0,start+endMs-performance.now())));
          deliveredSamples = offset+packet.length; deliveries.push({endMs,atMs:performance.now()});
          yield {identity,scope:'selected-video',sequence,audioRange:{startMs,endMs},
            capture:{clockId:'fixture-silence-document',startMs,endMs},
            sampleRate:16000,channels:1,sampleFormat:'pcm-f32le',pcm:packet.buffer};
        }
        ended = true;
      }
      for await (const revision of recognizer.run(paced())) transcripts.push({...revision,
        observedAtMs:performance.now(),deliveredSamples,ended});
      return {inputSamples:pcm.length,inputDurationMs:pcm.length/16,originalSamples:original.length,
        periodSamples,inputSha256:await digest(pcm),hostDurationMs:performance.now()-start,
        statuses,transcripts,invocations,deliveries,frames,ended};
    }, clip);
    Object.assign(run, measured, {peakRssKiB,finalRssKiB:await sampleRss()});
    const fail = message => observations.failures.push(`${clip.language}: ${message}`);
    assert.equal(run.inputSha256, hashes[clip.language], "Retain every sample of the independently observed long-silence inputs");
    assert.equal(run.ended, true); assert.equal(run.deliveries.at(-1).endMs, run.inputDurationMs);
    assert.ok(run.hostDurationMs >= run.inputDurationMs-1);
    assert.equal(run.frames.length, Math.ceil(run.inputSamples/512));
    let covered = 0;
    for (const frame of run.frames) {
      assert.equal(frame.startSample, covered); covered += frame.samples;
      assert.equal(frame.paddingSamples, 512-frame.samples);
    }
    assert.equal(covered, run.inputSamples);
    run.detectorInferenceMs = run.frames.reduce((sum,frame) => sum+frame.inferenceMs,0);
    assert.ok(run.detectorInferenceMs < run.inputDurationMs*0.1);
    run.maxPendingAudioMs = Math.max(...run.statuses.map(status => status.queue.pendingAudioMs));
    assert.ok(run.maxPendingAudioMs <= 30000);
    assert.equal(run.statuses.at(-1).queue.pendingAudioMs, 0);
    assert.ok(run.statuses.every(status => status.queue.droppedAudioMs === 0));
    assert.equal(run.invocations.length, 2); assert.equal(run.transcripts.length, 2);
    run.endpointLatenciesMs = []; run.lastActiveLatenciesMs = [];
    for (const [i, revision] of run.transcripts.entries()) {
      const job = run.invocations[i];
      assert.equal(job.exactInput, true); assert.equal(job.ended, false); assert.equal(revision.ended, false);
      assert.deepEqual(revision.identity, {sessionId:'fixture-silence',targetId:`fixture-${clip.language}`,epoch:6});
      assert.equal(revision.utteranceId, `speech-${i+1}`); assert.equal(revision.sourceRevision, 1);
      assert.equal(revision.final, true); assert.equal(revision.language, clip.language);
      assert.deepEqual(revision.audioRange, job.audioRange);
      assert.equal(job.samples, Math.round((job.audioRange.endMs-job.audioRange.startMs)*16));
      assert.ok(job.audioRange.endMs-job.audioRange.startMs <= 20000);
      if (i) assert.equal(job.audioRange.startMs, run.invocations[i-1].audioRange.endMs);
      const speechStart = 9600+i*run.periodSamples;
      const speechEnd = speechStart+run.originalSamples;
      assert.ok(job.audioRange.startMs*16 <= speechStart && job.audioRange.endMs*16 >= speechEnd,
        "Every original sample of each complete speech period reaches ASR");
      const nextOnset = i ? run.inputSamples : 9600+run.periodSamples;
      assert.ok(revision.deliveredSamples < nextOnset, "Text must arrive before the next onset or EOF");
      const endpoint = run.deliveries.find(packet => packet.endMs >= job.audioRange.endMs);
      const endpointLatency = revision.observedAtMs-endpoint.atMs;
      run.endpointLatenciesMs.push(endpointLatency);
      if (endpointLatency < 0 || endpointLatency >= 2000) fail("Endpoint-to-text exceeds the retained 2000 ms gate");
      const lastActive = run.frames.filter(frame => frame.speech && frame.startSample < speechStart+run.periodSamples
        && frame.startSample >= speechStart-512).at(-1);
      assert.ok(lastActive, "The real detector must identify the labeled speech period");
      const delivery = run.deliveries.find(packet => packet.endMs >= (lastActive.startSample+lastActive.samples)/16);
      const activeLatency = revision.observedAtMs-delivery.atMs;
      run.lastActiveLatenciesMs.push(activeLatency);
      if (activeLatency < 0 || activeLatency >= 3000) fail("Last-active-frame to text exceeds the 3000 ms long-silence gate");
    }
    const text = run.transcripts.map(revision => revision.text).join(" ");
    run.accuracy = errors(Array(2).fill(clip.text).join(" "),text,clip.language);
    if (run.accuracy.rate > 0.2) fail("CER/WER exceeds the retained 20% gate");
    const normalized = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g,clip.language === "ja" ? "" : " ");
    const anchors = clip.language === "ja" ? ["会議","しません","明日","午後","駅","予約","取り消さない"]
      : ["not meet today","station tomorrow","in the afternoon","not cancel the reservation"];
    run.meaningCounts = Object.fromEntries(anchors.map(anchor => [anchor, normalized.split(anchor).length-1]));
    if (Object.values(run.meaningCounts).some(count => count !== 2)) fail("Every meaning must occur exactly twice in these two complete speech periods");
    console.log(JSON.stringify({run}));
  }
  observations.pageErrors = pageErrors; observations.visibilityEvents = await page.evaluate(() => visibilityEvents);
  assert.deepEqual(pageErrors, []); assert.deepEqual(observations.visibilityEvents, []);
  observations.remotePaths = [...remotePaths];
  const pinned = "https://huggingface.co/onnx-community/whisper-small/resolve/36050c46d777d46dc4b5f43f6d90574fc38f8732/";
  const vadPinned = "https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx";
  assert.ok(remotePaths.has(vadPinned));
  assert.equal([...remotePaths].filter(path => path.startsWith(pinned)).length, 7);
  assert.ok([...remotePaths].every(path => path.startsWith(pinned)
    || path.startsWith("https://huggingface.co/api/resolve-cache/models/onnx-community/whisper-small/36050c46d777d46dc4b5f43f6d90574fc38f8732/")
    || path === vadPinned || path.startsWith("https://huggingface.co/api/resolve-cache/models/onnx-community/silero-vad/e71cae966052b992a7eca6b17738916ce0eca4ec/")
    || path.startsWith("https://us.aws.cdn.hf.co/xet-bridge-us/")), "Only pinned model artifacts/redirects may be remote");
  console.log(JSON.stringify({passed:observations.failures.length === 0,...observations}));
  assert.deepEqual(observations.failures, [], "Long-silence latency must preserve complete speech and meaning");
} catch (error) {
  observations.documentState = await page?.evaluate(() => ({visibility:document.visibilityState,visibilityEvents,
    prepared:globalThis.prepared,prepareError:globalThis.prepareError,lastStatus:globalThis.modelStatuses?.at(-1)}))
    .catch(failure => ({error:failure.message}));
  console.error(JSON.stringify({passed:false,...observations,error:error.message})); throw error;
} finally {
  clearInterval(monitor);
  await browser?.close(); browserProcess?.kill("SIGTERM"); await browserExit;
  if (profile) await rm(profile, {recursive:true,force:true});
  await new Promise(done => server.close(done));
}
