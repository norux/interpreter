import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";

// B2 fixed EOF alignment qualification only. Real models receive paced decoded
// synthetic PCM, not live acquisition, natural speech or Korean caption input.
const quiet = process.argv.includes("--quiet-input");
const sustained = process.argv.includes("--sustained-input");
assert.ok(!(quiet && sustained), "Quiet and sustained qualifications must run separately");
const cases = quiet ? [1, 0.25, 0.1].map(gain => ({ gain, tailSamples: 511 }))
  : [0, 341, 511, 853, 1365].map(tailSamples => ({ gain: 1, tailSamples }));
const output = resolve(".ralph/media-framework/chrome-eof-build");
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
const observations = { scope: "B2 fixed EOF alignment and optional sustained learned coverage/accuracy; real WASM VAD and FP16 WebGPU ASR over paced decoded synthetic PCM, no live acquisition/translation/DOM", quiet, sustained, runs: [], failures: [] };
const execute = promisify(execFile);
let browser; let browserProcess; let browserExit; let profile; let page; let monitor;
let peakRssKiB = 0;
let sustainedMemory;
async function sampleRss() {
  const { stdout } = await execute("ps", ["-axo", "pid=,ppid=,rss="]);
  const processes = stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([browserProcess.pid]);
  for (let added = true; added;) {
    added = false;
    for (const [pid, parent] of processes) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); added = true; }
  }
  const rss = processes.filter(([pid]) => owned.has(pid)).reduce((sum, [, , memory]) => sum + memory, 0);
  peakRssKiB = Math.max(peakRssKiB, rss);
  if (sustainedMemory) {
    const elapsedMs = performance.now() - sustainedMemory.start;
    if (Math.floor(elapsedMs/60000) >= sustainedMemory.samples.length) {
      const sample = { elapsedMs, rssKiB: rss };
      sustainedMemory.samples.push(sample);
      console.log(JSON.stringify({ sustainedMemory: { language: sustainedMemory.language, periods: sustainedMemory.periods, ...sample } }));
    }
  }
  return rss;
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
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-eof-profile-"));
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
  for (const clip of manifest.clips) for (const { gain, tailSamples, periods } of [
    ...cases.map(value => ({ ...value, periods: 3 })),
    ...(sustained ? [5, Math.ceil(120/clip.speechDurationSeconds)].map(periods => ({ gain: 1, tailSamples: 511, periods })) : []),
  ]) {
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    const run = { language: clip.language, gain, tailSamples, periods, baselineRssKiB: await sampleRss() };
    observations.runs.push(run); peakRssKiB = run.baselineRssKiB;
    const preparationStart = performance.now();
    await page.locator("#prepare").focus(); await page.locator("#prepare").press("Enter");
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 240000, polling: 100 });
    run.preparationMs = performance.now() - preparationStart;
    const status = await page.evaluate(() => ({ error: prepareError, last: modelStatuses.at(-1), vadStatuses }));
    run.vadStatuses = status.vadStatuses;
    assert.equal(run.vadStatuses.at(-1).state, "ready"); assert.equal(run.vadStatuses.at(-1).requiredBytes, 2243022);
    if (observations.runs.length > 1) for (const statuses of [run.vadStatuses, await page.evaluate(() => modelStatuses)]) {
      assert.ok(statuses.some(status => status.state === "cached"));
      assert.ok(statuses.every(status => status.state !== "downloading"));
    }
    assert.equal(status.error, undefined); assert.equal(status.last.state, "ready"); assert.equal(status.last.requiredBytes, 487960440);
    if (periods > 3) sustainedMemory = { language: clip.language, periods, start: performance.now(), samples: [] };
    const measured = await page.evaluate(async ({ clip, gain, tailSamples, periods }) => {
      const original = await readClip(clip);
      // Controlled quieter input, including its original carrier. No trimming,
      // denoising or gain restoration occurs in the detector or ASR pipeline.
      const scaled = original.map(sample => sample * gain);
      // Keep every sample position in complete periods. Only known zero
      // context is prepended/appended; the recognizer never receives labels.
      const prefixSamples = 512;
      const pcm = new Float32Array(prefixSamples + original.length*periods + tailSamples);
      for (let repeat = 0; repeat < periods; repeat++) pcm.set(scaled, prefixSamples + repeat*original.length);
      const digest = async samples => [...new Uint8Array(await crypto.subtle.digest('SHA-256', samples.buffer))]
        .map(byte => byte.toString(16).padStart(2,'0')).join('');
      const inputSha256 = await digest(pcm);
      const originalSha256 = await digest(original);
      const scaledPeak = scaled.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
      const scaledRms = Math.sqrt(scaled.reduce((sum, sample) => sum+sample*sample, 0)/scaled.length);
      const identity = {sessionId: 'fixture-eof', targetId: `fixture-${clip.language}`, epoch: 4};
      const statuses = []; const transcripts = []; const invocations = []; const deliveries = []; const detectorFrames = [];
      const executor = { stop: () => host.stop(), recognize: async job => {
        const startSample = Math.round(job.audioRange.startMs*16);
        const inputSlice = pcm.slice(startSample, startSample+job.pcm.length);
        const invocation = {audioRange: {...job.audioRange}, samples: job.pcm.length,
          exactInput: job.pcm.every((sample,i) => sample === inputSlice[i]), pcmSha256: await digest(job.pcm)};
        invocations.push(invocation); invocation.atMs = performance.now();
        try { return await host.recognize(job); } finally { invocation.settledAtMs = performance.now(); }
      }};
      let detectorSamples = 0;
      const detector = {stop: () => vad.stop(), detect: async frame => {
        const snapshot = frame.slice();
        const result = await vad.detect(frame);
        if (!frame.every((sample,i) => sample === snapshot[i])) throw new Error('Detector altered ASR PCM');
        detectorFrames.push({...result, startSample:detectorSamples, atMs:performance.now()});
        detectorSamples += frame.length;
        return result;
      }};
      const recognizer = createSpeechRecognizer(identity, clip.language, executor, status => statuses.push({...status, atMs: performance.now()}), detector);
      const start = performance.now();
      async function* paced() {
        for (let offset = 0, sequence = 0; offset < pcm.length; offset += 1600, sequence++) {
          const packet = pcm.slice(offset,offset+1600);
          const startMs = offset/16; const endMs = startMs+packet.length/16;
          await new Promise(done => setTimeout(done,Math.max(0,start+endMs-performance.now())));
          deliveries.push({endMs,atMs:performance.now()});
          yield {identity,scope:'selected-video',sequence,audioRange:{startMs,endMs},
            capture:{clockId:'fixture-eof-document',startMs,endMs},sampleRate:16000,channels:1,sampleFormat:'pcm-f32le',pcm:packet.buffer};
        }
      }
      let outcome = 'completed';
      try { for await (const revision of recognizer.run(paced())) transcripts.push({...revision,observedAtMs:performance.now()}); }
      catch (error) { outcome = error.message; }
      const submittedEndSample = Math.round((transcripts.at(-1)?.audioRange.endMs ?? 0)*16);
      const rejectedTail = pcm.subarray(submittedEndSample);
      const rejectedTailPeak = rejectedTail.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
      const rejectedTailRms = rejectedTail.length ? Math.sqrt(rejectedTail.reduce((sum, sample) => sum+sample*sample, 0)/rejectedTail.length) : 0;
      return {outcome,rejectedTailPeak,rejectedTailRms,originalSamples:original.length,inputSamples:pcm.length,inputDurationMs:pcm.length/16,
        originalSha256,scaledPeak,scaledRms,inputSha256,prefixSamples,originalEndSample:prefixSamples+original.length*periods,hostDurationMs:performance.now()-start,transcripts,invocations,deliveries,statuses,detectorFrames};
    }, { clip, gain, tailSamples, periods });
    Object.assign(run, measured, { peakRssKiB, finalRssKiB: await sampleRss(), memorySamples: sustainedMemory?.samples });
    sustainedMemory = undefined;
    const fail = message => observations.failures.push(`${clip.language}/gain-${gain}/tail-${tailSamples}/periods-${periods}: ${message}`);
    assert.ok(run.scaledPeak > 0 && run.scaledPeak <= gain);
    assert.ok(run.scaledRms > 0 && run.scaledRms <= run.scaledPeak);
    const previous = observations.runs.find(other => other !== run && other.language === clip.language);
    if (previous) assert.equal(run.originalSha256, previous.originalSha256);
    if (run.outcome !== "completed") fail(run.outcome);
    assert.equal(run.inputSamples, 512 + run.originalSamples*periods + tailSamples);
    assert.equal(run.detectorFrames.length, Math.ceil(run.inputSamples/512));
    let covered = 0;
    for (const frame of run.detectorFrames) {
      assert.equal(frame.startSample, covered); covered += frame.samples;
      assert.equal(frame.paddingSamples, 512-frame.samples);
    }
    assert.equal(covered, run.inputSamples);
    run.detectorInferenceMs = run.detectorFrames.reduce((sum, frame) => sum+frame.inferenceMs, 0);
    if (run.detectorInferenceMs >= run.inputDurationMs*0.1) fail("Detector inference exceeds retained 10% duration gate");
    assert.equal(run.deliveries.at(-1).endMs, run.inputDurationMs);
    assert.ok(run.hostDurationMs >= run.inputDurationMs-1);
    run.maxPendingAudioMs = Math.max(...run.statuses.map(status => status.queue.pendingAudioMs));
    assert.ok(run.maxPendingAudioMs <= 30000); assert.equal(run.statuses.at(-1).queue.pendingAudioMs, 0);
    if (run.statuses.some(status => status.queue.droppedAudioMs !== 0)) fail("discarded audio");
    assert.ok(run.invocations.every(job => job.exactInput));
    assert.equal(run.invocations.length, run.transcripts.length);
    run.endpointLatenciesMs = run.transcripts.map((revision, i) => {
      assert.deepEqual(revision.identity, { sessionId: "fixture-eof", targetId: `fixture-${clip.language}`, epoch: 4 });
      assert.equal(revision.sourceRevision, 1); assert.equal(revision.final, true); assert.equal(revision.language, clip.language);
      assert.equal(revision.utteranceId, `speech-${i+1}`);
      assert.deepEqual(revision.audioRange, run.invocations[i].audioRange);
      assert.equal(run.invocations[i].samples, Math.round((revision.audioRange.endMs-revision.audioRange.startMs)*16));
      assert.ok(revision.audioRange.endMs-revision.audioRange.startMs <= 20000);
      if (i) assert.equal(revision.audioRange.startMs, run.transcripts[i-1].audioRange.endMs);
      const delivery = run.deliveries.find(packet => packet.endMs >= revision.audioRange.endMs);
      return revision.observedAtMs-delivery.atMs;
    });
    if (run.endpointLatenciesMs.some(ms => ms < 0 || ms >= 2000)) fail("endpoint-to-text exceeds preserved 2000 ms gate");
    run.leadingContextMs = run.transcripts[0]?.audioRange.startMs;
    run.trailingContextMs = run.inputDurationMs - (run.transcripts.at(-1)?.audioRange.endMs ?? 0);
    run.originalTailNotSubmittedSamples = Math.max(0, run.originalEndSample - Math.round((run.transcripts.at(-1)?.audioRange.endMs ?? 0)*16));
    if (!(run.leadingContextMs >= 0 && run.leadingContextMs <= 100)) fail("leading context exceeds preserved 100 ms gate");
    if (!(run.trailingContextMs >= 0 && run.trailingContextMs < 20)) fail(`trailing context ${run.trailingContextMs} ms exceeds preserved <20 ms gate`);
    if (run.originalTailNotSubmittedSamples) fail(`${run.originalTailNotSubmittedSamples} original tail samples did not reach ASR`);
    const text = run.transcripts.map(revision => revision.text).join(" ");
    run.accuracy = errors(Array(periods).fill(clip.text).join(" "), text, clip.language);
    if (run.accuracy.rate > 0.2) fail(`${run.accuracy.metric} exceeds preserved 20% gate`);
    const normalized = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, clip.language === "ja" ? "" : " ");
    const anchors = clip.language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
      : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
    run.meaningCounts = Object.fromEntries(anchors.map(anchor => [anchor, normalized.split(anchor).length-1]));
    if (Object.values(run.meaningCounts).some(count => count !== periods)) fail(`every preserved meaning must occur exactly ${periods} times`);
    if (periods > 3) {
      assert.ok(run.inputDurationMs > 30000, "Long learned input must exceed the complete queue budget");
      assert.ok(run.transcripts.length >= Math.ceil((run.inputDurationMs-run.leadingContextMs-run.trailingContextMs)/20000));
      const overlaps = run.invocations.filter(job => run.deliveries.some(packet => packet.atMs > job.atMs && packet.atMs < job.settledAtMs));
      assert.ok(overlaps.length >= run.invocations.length-1, "Paced acquisition must continue during every nonfinal ASR job");
      run.inferenceOverlapJobs = overlaps.length;
      run.minuteQueues = Array.from({ length: Math.ceil(run.inputDurationMs/60000) }, (_, minute) => {
        const start = run.deliveries[0].atMs-100+minute*60000;
        const statuses = run.statuses.filter(status => status.atMs >= start && status.atMs < start+60000);
        assert.ok(statuses.length, "Every sustained minute must contain actual queue observations");
        return { minute: minute+1, maxPendingAudioMs: Math.max(...statuses.map(status => status.queue.pendingAudioMs)),
          finalPendingAudioMs: statuses.at(-1).queue.pendingAudioMs, droppedAudioMs: statuses.at(-1).queue.droppedAudioMs };
      });
      if (periods > 5) {
        assert.ok(run.originalSamples*periods/16 >= 120000, "Each sustained language must receive at least two minutes of actual speech periods");
        assert.ok(run.memorySamples.length >= 3, "Sample owned process RSS at the start and both minute boundaries");
      }
    }
    console.log(JSON.stringify({ run }));
  }
  observations.pageErrors = pageErrors;
  observations.visibilityEvents = await page.evaluate(() => visibilityEvents);
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
  console.log(JSON.stringify({ passed: observations.failures.length === 0, ...observations }));
  assert.deepEqual(observations.failures, [], "EOF alignment must preserve coverage, every meaning and latency");
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
