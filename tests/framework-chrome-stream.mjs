import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-stream-build");
const manifest = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
for (const clip of manifest.clips) {
  const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
  assert.equal(bytes.length, clip.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
}
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: { asr: resolve("packages/engines-browser/asr-host.ts"), speech: resolve("packages/engines-browser/speech-recognizer.ts"),
    normalize: resolve("packages/engines-browser/normalize-audio.ts"), input: resolve("packages/media-web/audio-input.ts"),
    catalog: resolve("packages/media-web/catalog.ts"), timeline: resolve("packages/core/timeline.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/live") {
    response.setHeader("Content-Type", "text/html"); response.end(await readFile("tests/fixtures/chrome-live-asr.html")); return;
  }
  if (path === "/pcm-worklet.js") {
    response.setHeader("Content-Type", "text/javascript"); response.end(await readFile("packages/media-web/pcm-worklet.js")); return;
  }
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare">Prepare</button><script type="module">
      import {createAsrHost} from '/asr.js';
      import {createSpeechRecognizer} from '/speech.js';
      globalThis.makeRecognizer = (language, epoch = 3) => {
        globalThis.queueStatuses = []; globalThis.transcripts = [];
        globalThis.identity = {sessionId: 'fixture-stream', targetId: 'fixture-'+language, epoch};
        globalThis.recognizer = createSpeechRecognizer(identity, language, host, status => queueStatuses.push({...status, atMs: performance.now()}));
      };
      globalThis.collect = async (audio) => {
        for await (const revision of recognizer.run(audio)) transcripts.push({...revision, observedAtMs: performance.now()});
      };
      globalThis.chunk = (pcm, sequence, startMs) => ({identity, scope: 'selected-video', sequence,
        audioRange: {startMs, endMs: startMs + pcm.length/16}, capture: {clockId: 'fixture-document', startMs, endMs: startMs+pcm.length/16},
        sampleRate: 16000, channels: 1, sampleFormat: 'pcm-f32le', pcm: pcm.buffer});
      globalThis.packets = (pcm, repeat) => {
        // Original decoded speech, including the isolation tag, followed by
        // explicit synthetic zero silence. No source sample or sentence removed.
        const period = new Float32Array(Math.ceil((pcm.length+9600)/1600)*1600); period.set(pcm);
        return Array.from({length: period.length/1600*repeat}, (_,i) =>
          chunk(period.slice(i*1600%period.length, i*1600%period.length+1600), i, i*100));
      };
      globalThis.paced = async function* (packets) {
        const start = performance.now(); globalThis.deliveryTimes = [];
        for (const packet of packets) {
          await new Promise(done => setTimeout(done, Math.max(0, start+packet.audioRange.endMs-performance.now())));
          deliveryTimes.push({endMs: packet.audioRange.endMs, atMs: performance.now()}); yield packet;
        }
      };
      const NativeWorker = Worker; globalThis.ownedWorkers = [];
      globalThis.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); ownedWorkers.push(this); }
      };
      globalThis.makeHost = (candidate, device) => {
        globalThis.statuses = []; globalThis.prepared = false; globalThis.prepareError = undefined;
        globalThis.host = createAsrHost(document, candidate, device, status => statuses.push(status));
      };
      globalThis.visibilityEvents = [];
      document.addEventListener('visibilitychange', () => visibilityEvents.push({state: document.visibilityState, atMs: performance.now()}));
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
const observations = { scope: "B2 experimental streaming ASR: paced decoded synthetic PCM and separately asserted live selected-video normalization; no translation/caption DOM", runs: [], checks: [] };
let browser; let browserProcess; let browserExit; let profile; let monitor; let page;
let peakRssKiB = 0;
let continuousMemory;
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
  peakRssKiB = Math.max(peakRssKiB, rss);
  if (continuousMemory) {
    const elapsedMs = performance.now() - continuousMemory.start;
    if (Math.floor(elapsedMs / 60000) >= continuousMemory.samples.length) {
      const sample = { elapsedMs, rssKiB: rss };
      continuousMemory.samples.push(sample);
      console.log(JSON.stringify({ continuousMemory: { language: continuousMemory.language, repeats: continuousMemory.repeats, ...sample } }));
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
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-stream-profile-"));
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
  observations.memoryMetric = "Owned browser process-tree RSS KiB, 250ms sampling; shared pages/allocator/browser/GPU process included, not isolated allocations or leak evidence";
  page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(10000);
  const pageErrors = []; const remotePaths = new Set(); let remoteRequests = 0;
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { if (request.url().startsWith("https://")) { remoteRequests++; const url = new URL(request.url()); remotePaths.add(url.origin + url.pathname); } });
  let latestWorker; let instrumentation;
  page.on("worker", worker => {
    latestWorker = worker;
    instrumentation = worker.evaluate(() => {
      const original = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await original.apply(this, args); globalThis.testRuntimeDevice = device; return device;
      };
    });
  });
  monitor = setInterval(() => { void sampleRss().catch(() => {}); }, 250);
  await page.goto(origin); await page.waitForFunction(() => globalThis.makeHost);
  observations.baselineRssKiB = await sampleRss();
  async function prepare(language) {
    await page.bringToFront();
    assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    await page.evaluate(language => { globalThis.host?.dispose(); makeHost("smallFp16", "webgpu"); makeRecognizer(language); }, language);
    const begin = performance.now();
    await page.locator("#prepare").click();
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 240000, polling: 100 });
    const status = await page.evaluate(() => ({ failure: prepareError, last: statuses.at(-1) }));
    assert.equal(status.failure, undefined); assert.equal(status.last.state, "ready");
    assert.equal(status.last.requiredBytes, 487960440);
    await instrumentation;
    return { preparationMs: performance.now() - begin, status };
  }
  const failures = [];
  for (const clip of manifest.clips) {
    const run = { language: clip.language, candidate: "smallFp16", device: "webgpu", dtype: "fp16" };
    observations.runs.push(run); run.baselineRssKiB = await sampleRss(); peakRssKiB = run.baselineRssKiB;
    Object.assign(run, await prepare(clip.language));
    const measured = await page.evaluate(async clip => {
      const pcm = await readClip(clip); const input = packets(pcm, 3);
      const start = performance.now();
      await collect(paced(input));
      return { inputSamplesPerSpeech: pcm.length, inputDurationMs: input.at(-1).audioRange.endMs,
        hostDurationMs: performance.now() - start, transcripts, deliveryTimes, statuses: queueStatuses };
    }, clip);
    run.peakRssKiB = peakRssKiB;
    Object.assign(run, measured);
    assert.equal(measured.transcripts.length, 3, "Every preserved utterance must be recognized");
    assert.ok(measured.statuses.every(status => !status.reason && status.queue.droppedAudioMs === 0));
    run.maxPendingAudioMs = Math.max(...measured.statuses.map(status => status.queue.pendingAudioMs));
    assert.ok(run.maxPendingAudioMs <= 30000);
    assert.equal(measured.statuses.at(-1).queue.pendingAudioMs, 0);
    run.results = measured.transcripts.map((revision, i) => {
      assert.deepEqual(revision.identity, { sessionId: "fixture-stream", targetId: `fixture-${clip.language}`, epoch: 3 });
      assert.equal(revision.utteranceId, `speech-${i + 1}`); assert.equal(revision.sourceRevision, 1);
      assert.equal(revision.final, true); assert.equal(revision.language, clip.language);
      const periodMs = measured.inputDurationMs / 3;
      assert.equal(revision.audioRange.startMs, i * periodMs);
      assert.equal(revision.audioRange.endMs, i * periodMs + Math.ceil(measured.inputSamplesPerSpeech / 320) * 20 + 500);
      const readyAt = measured.deliveryTimes.find(delivery => delivery.endMs >= revision.audioRange.endMs).atMs;
      const endpointToResultMs = revision.observedAtMs - readyAt;
      assert.ok(endpointToResultMs >= 0 && endpointToResultMs < periodMs, "Profile must keep up with this paced repeat");
      const accuracy = errors(clip.text, revision.text, clip.language);
      if (accuracy.rate > 0.2) failures.push(`${clip.language}/trial-${i + 1}: ${accuracy.metric} ${accuracy.rate} exceeds preserved 0.2 gate`);
      const anchors = clip.language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
        : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
      assert.ok(anchors.every(anchor => revision.text.includes(anchor)), "Preserve the tested negation/time/station/cancellation meaning");
      return { trial: i + 1, audioRange: revision.audioRange, endpointToResultMs, accuracy };
    });
    console.log(JSON.stringify({ run }));
  }
  // Exact English ranges that omitted a complete speech period in the original
  // ten-minute run, plus its neighboring passing range. Reconstruct from the
  // hash-checked decoded period; no stored transcript or expected text is input.
  await prepare("en");
  const repetitionReplay = await page.evaluate(async clip => {
    const period = await readClip(clip);
    const ranges = [[128040, 141380], [141380, 154700], [181380, 194700], [221360, 234700],
      [261360, 274700], [408040, 421360], [448040, 461360], [488020, 501360], [528020, 541360]];
    const results = [];
    for (const [startMs, endMs] of ranges) {
      const pcm = new Float32Array((endMs - startMs) * 16);
      for (let i = 0; i < pcm.length; i++) pcm[i] = period[(startMs * 16 + i) % period.length];
      const started = performance.now();
      const result = await host.recognize({ identity, language: "en", utteranceId: `phase-${startMs}`,
        audioRange: { startMs, endMs }, pcm });
      results.push({ ...result, samples: (endMs - startMs) * 16, hostMs: performance.now() - started });
    }
    return results;
  }, manifest.clips[1]);
  observations.repetitionReplay = repetitionReplay;
  const rotatedPeriod = "Let's meet at the station tomorrow at three in the afternoon. Please do not cancel the reservation. We will not meet today.";
  for (const replay of repetitionReplay) {
    assert.deepEqual(replay.revision.identity, { sessionId: "fixture-stream", targetId: "fixture-en", epoch: 3 });
    assert.equal(replay.revision.language, "en"); assert.equal(replay.revision.final, true); assert.equal(replay.revision.sourceRevision, 1);
    assert.equal(replay.samples, (replay.revision.audioRange.endMs - replay.revision.audioRange.startMs) * 16);
    replay.accuracy = errors(`${rotatedPeriod} ${rotatedPeriod}`, replay.revision.text, "en");
    if (replay.accuracy.rate > 0.2) failures.push(`en/replay-${replay.revision.audioRange.startMs}: WER exceeds preserved 0.2 gate`);
    replay.meaningCounts = Object.fromEntries(["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"]
      .map(anchor => [anchor, replay.revision.text.toLowerCase().split(anchor).length - 1]));
    if (Object.values(replay.meaningCounts).some(count => count !== 2))
      failures.push(`en/replay-${replay.revision.audioRange.startMs}: repeated meaning must occur exactly twice`);
    if (!(replay.hostMs >= 0 && replay.hostMs < 2000)) failures.push(`en/replay-${replay.revision.audioRange.startMs}: host call exceeds 2000 ms`);
  }
  console.log(JSON.stringify({ repetitionReplay }));

  // Deliberately unpaced input pressure, not a measured normal-video failure.
  await prepare("ja");
  const overload = await page.evaluate(async clip => {
    const input = packets(await readClip(clip), 4);
    const result = await collect((async function* () { yield* input; })()).then(() => "unexpected success", error => error.message);
    await new Promise(done => setTimeout(done, 200));
    return { result, transcripts, last: queueStatuses.at(-1), maxPendingAudioMs: Math.max(...queueStatuses.map(status => status.queue.pendingAudioMs)) };
  }, manifest.clips[0]);
  assert.equal(overload.result, "overloaded"); assert.deepEqual(overload.transcripts, []);
  assert.equal(overload.last.reason, "overloaded"); assert.equal(overload.last.queue.pendingAudioMs, 0);
  assert.ok(overload.last.queue.droppedAudioMs > 0); assert.ok(overload.maxPendingAudioMs <= 30000);
  observations.overload = overload;

  await prepare("ja");
  const gap = await page.evaluate(async clip => {
    const input = packets(await readClip(clip), 1).slice(0, 2); input[1].sequence += 1;
    const result = await collect((async function* () { yield* input; })()).then(() => "unexpected success", error => error.message);
    return { result, transcripts, last: queueStatuses.at(-1) };
  }, manifest.clips[0]);
  assert.equal(gap.result, "audio-gap"); assert.deepEqual(gap.transcripts, []);
  assert.equal(gap.last.queue.droppedAudioMs, 100); observations.gap = gap;

  // Observe the real production pipeline invocation before cancelling the stream.
  await prepare("ja");
  await latestWorker.evaluate(() => {
    let probePort; const original = globalThis.onmessage;
    globalThis.onmessage = function (event) {
      if (event.data?.fixtureAsrProbe) { probePort = event.data.port; return; }
      const result = original.call(this, event);
      if (event.data?.type === "recognize") probePort?.postMessage("pipeline-invoked");
      return result;
    };
  });
  const cancellation = await page.evaluate(async clip => {
    const channel = new MessageChannel(); let invoked = false;
    channel.port1.onmessage = () => { invoked = true; void recognizer.cancel(identity); channel.port1.close(); };
    ownedWorkers.at(-1).postMessage({ fixtureAsrProbe: true, port: channel.port2 }, [channel.port2]);
    const input = packets(await readClip(clip), 1);
    const result = await collect((async function* () { yield* input; })()).then(() => "unexpected success", error => error.message);
    await new Promise(done => setTimeout(done, 200));
    return { result, invoked, transcripts, last: queueStatuses.at(-1) };
  }, manifest.clips[0]);
  assert.equal(cancellation.invoked, true); assert.equal(cancellation.result, "cancelled");
  assert.deepEqual(cancellation.transcripts, []); observations.cancellation = cancellation;

  await prepare("en");
  const silence = await page.evaluate(async () => {
    const original = host.recognize; let calls = 0;
    host.recognize = job => { calls++; return original(job); };
    await collect((async function* () { for (let i = 0; i < 20; i++) yield chunk(new Float32Array(1600), i, i * 100); })());
    return { calls, transcripts, last: queueStatuses.at(-1) };
  });
  assert.equal(silence.calls, 0); assert.deepEqual(silence.transcripts, []);
  assert.equal(silence.last.queue.droppedAudioMs, 0); observations.silence = silence;

  await prepare("en");
  assert.equal(await latestWorker.evaluate(() => !!globalThis.testRuntimeDevice), true);
  await latestWorker.evaluate(() => globalThis.testRuntimeDevice.destroy());
  await page.waitForTimeout(300);
  const loss = await page.evaluate(async clip => {
    const input = packets(await readClip(clip), 1);
    const result = await collect((async function* () { yield* input; })()).then(() => "unexpected success", error => error.message);
    return { result, transcripts, last: queueStatuses.at(-1) };
  }, manifest.clips[1]);
  assert.equal(loss.result, "gpu-lost"); assert.deepEqual(loss.transcripts, []); observations.gpuLoss = loss;
  await page.evaluate(() => { host.dispose(); });
  // Destroy the actual runtime device only after the production handler has
  // entered recognition. Recovery must be an explicit Prepare on the same host,
  // with a fresh recognizer/epoch, never a retry or a backend/model fallback.
  observations.gpuRecoveryRuns = [];
  for (const clip of manifest.clips) {
    const recovery = { language: clip.language, baselineRssKiB: await sampleRss() };
    observations.gpuRecoveryRuns.push(recovery);
    peakRssKiB = recovery.baselineRssKiB;
    Object.assign(recovery, await prepare(clip.language));
    await latestWorker.evaluate(() => {
      let probePort; const original = globalThis.onmessage;
      globalThis.onmessage = function (event) {
        if (event.data?.fixtureLossProbe) { probePort = event.data.port; return; }
        const result = original.call(this, event);
        if (event.data?.type === "recognize") {
          probePort.postMessage({ audioRange: event.data.job.audioRange, samples: event.data.job.pcm.length });
          globalThis.testRuntimeDevice.destroy();
        }
        return result;
      };
    });
    recovery.loss = await page.evaluate(async clip => {
      globalThis.recoveryHost = host;
      const workersBeforeLoss = ownedWorkers.length;
      const channel = new MessageChannel(); let invocation;
      channel.port1.onmessage = event => { invocation = event.data; channel.port1.close(); };
      ownedWorkers.at(-1).postMessage({ fixtureLossProbe: true, port: channel.port2 }, [channel.port2]);
      const start = performance.now();
      const result = await collect((async function* () { yield* packets(await readClip(clip), 1); })())
        .then(() => "unexpected success", error => error.message);
      await new Promise(done => setTimeout(done, 200));
      const job = { identity, language: clip.language, utteranceId: "must-not-retry",
        audioRange: { startMs: 0, endMs: 100 }, pcm: new Float32Array(1600) };
      const withoutPrepare = await host.recognize(job).then(() => "unexpected success", error => error.message);
      return { result, invocation, withoutPrepare, retainedCallerBytes: job.pcm.byteLength,
        transcripts, statuses: queueStatuses, workersBeforeLoss, workers: ownedWorkers.length, hostDurationMs: performance.now() - start };
    }, clip);
    assert.equal(recovery.loss.result, "gpu-lost");
    assert.ok(recovery.loss.invocation.samples > 1600, "Loss must interrupt an actual speech job");
    assert.equal(recovery.loss.withoutPrepare, "gpu-lost");
    assert.equal(recovery.loss.workers, recovery.loss.workersBeforeLoss, "GPU loss must not create an automatic replacement");
    assert.equal(recovery.loss.retainedCallerBytes, 6400, "Rejected retry must not transfer input");
    assert.deepEqual(recovery.loss.transcripts, []);
    assert.equal(recovery.loss.statuses.at(-1).reason, "gpu-lost");
    assert.equal(recovery.loss.statuses.at(-1).queue.pendingAudioMs, 0);
    assert.ok(recovery.loss.statuses.at(-1).queue.droppedAudioMs > 0);
    assert.ok(recovery.loss.statuses.every(status => status.queue.pendingAudioMs <= 30000));
    await page.evaluate(language => {
      globalThis.statuses = []; globalThis.prepared = false; globalThis.prepareError = undefined;
      makeRecognizer(language, 4);
    }, clip.language);
    const requestsBefore = remoteRequests, begin = performance.now();
    await page.locator("#prepare").click();
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 120000, polling: 100 });
    recovery.repreparationMs = performance.now() - begin;
    await instrumentation;
    recovery.preparation = await page.evaluate(() => ({ sameHost: host === recoveryHost, failure: prepareError,
      statuses, workers: ownedWorkers.length }));
    assert.equal(recovery.preparation.sameHost, true); assert.equal(recovery.preparation.failure, undefined);
    assert.equal(recovery.preparation.workers, recovery.loss.workers + 1, "Only explicit Prepare creates a replacement worker");
    assert.ok(recovery.preparation.statuses.some(status => status.state === "cached"));
    assert.ok(recovery.preparation.statuses.every(status => status.state !== "downloading"));
    assert.equal(recovery.preparation.statuses.at(-1).state, "ready");
    assert.equal(recovery.preparation.statuses.at(-1).requiredBytes, 487960440);
    assert.equal(await latestWorker.evaluate(() => !!globalThis.testRuntimeDevice), true);
    recovery.recovered = await page.evaluate(async clip => {
      const input = packets(await readClip(clip), 3); const start = performance.now();
      await collect(paced(input));
      return { transcripts, statuses: queueStatuses, deliveryTimes, visibilityEvents,
        hostDurationMs: performance.now() - start, inputDurationMs: input.at(-1).audioRange.endMs };
    }, clip);
    recovery.remoteRequests = remoteRequests - requestsBefore;
    assert.equal(recovery.remoteRequests, 0, "Cached recovery must not fetch remote model artifacts");
    assert.equal(recovery.recovered.transcripts.length, 3);
    assert.ok(recovery.recovered.statuses.every(status => !status.reason && status.queue.droppedAudioMs === 0 && status.queue.pendingAudioMs <= 30000));
    assert.equal(recovery.recovered.statuses.at(-1).queue.pendingAudioMs, 0);
    assert.deepEqual(recovery.recovered.visibilityEvents, []);
    recovery.results = recovery.recovered.transcripts.map((revision, i) => {
      assert.deepEqual(revision.identity, { sessionId: "fixture-stream", targetId: `fixture-${clip.language}`, epoch: 4 });
      assert.equal(revision.utteranceId, `speech-${i + 1}`); assert.equal(revision.sourceRevision, 1);
      assert.equal(revision.final, true); assert.equal(revision.language, clip.language);
      assert.equal(revision.audioRange.startMs, i * recovery.recovered.inputDurationMs / 3);
      assert.equal(revision.audioRange.endMs, recovery.loss.invocation.audioRange.endMs + revision.audioRange.startMs);
      const delivered = recovery.recovered.deliveryTimes.find(packet => packet.endMs >= revision.audioRange.endMs);
      const endpointToResultMs = revision.observedAtMs - delivered.atMs;
      assert.ok(endpointToResultMs >= 0 && endpointToResultMs < recovery.recovered.inputDurationMs / 3);
      const accuracy = errors(clip.text, revision.text, clip.language);
      if (accuracy.rate > 0.2) failures.push(`${clip.language}/GPU-recovery-${i + 1}: ${accuracy.metric} ${accuracy.rate} exceeds preserved 0.2 gate`);
      const anchors = clip.language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
        : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
      assert.ok(anchors.every(anchor => revision.text.includes(anchor)), "GPU recovery must preserve every existing meaning anchor");
      return { trial: i + 1, accuracy, endpointToResultMs };
    });
    recovery.peakRssKiB = peakRssKiB;
    recovery.maxPendingAudioMs = Math.max(...recovery.recovered.statuses.map(status => status.queue.pendingAudioMs));
    console.log(JSON.stringify({ recovery }));
    await page.evaluate(() => host.dispose());
  }
  observations.remotePaths = [...remotePaths]; observations.pageErrors = pageErrors; observations.failures = failures;
  observations.visibilityEvents = await page.evaluate(() => visibilityEvents);
  assert.ok([...remotePaths].every(path => /^https:\/\/huggingface.co\/(onnx-community\/whisper-small\/resolve\/36050c46d777d46dc4b5f43f6d90574fc38f8732\/|api\/resolve-cache\/models\/onnx-community\/whisper-small\/36050c46d777d46dc4b5f43f6d90574fc38f8732\/)/.test(path)
    || ["us.aws.cdn.hf.co", "cas-bridge.xethub.hf.co", "cas-server.xethub.hf.co"].includes(new URL(path).hostname)), "Only this pinned profile's model artifacts and storage redirects may be fetched");
  assert.deepEqual(pageErrors, []); assert.deepEqual(failures, [], "Preserved numerical accuracy gates must pass");
  observations.liveRuns = [];
  await page.goto(`${origin}/live`); await page.waitForFunction(() => globalThis.ready);
  for (const [round, language] of ["ja", "ja", "ja", "en", "ja", "en"].entries()) {
    const clip = manifest.clips.find(clip => clip.language === language);
    const periods = round >= 4 ? 3 : 1;
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    await page.evaluate(({ language, duration, round }) => configure(language, duration, round), { language, duration: clip.speechDurationSeconds * periods, round });
    // Keep trusted activation without moving the pointer beside native media
    // volume controls; playback-state equality remains required in every round.
    await page.locator("#prepare").press("Enter");
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 120000, polling: 100 });
    assert.equal(await page.evaluate(() => prepareError), undefined);
    const live = { round, language, periods, baselineRssKiB: await sampleRss() }; peakRssKiB = live.baselineRssKiB;
    await page.locator("#start").press("Enter");
    if (round === 1) {
      await page.waitForFunction(() => normalized.chunks >= 20 || globalThis.liveError, undefined, { polling: 100 });
      await page.locator("#stop").press("Enter");
    }
    await page.waitForFunction(() => globalThis.finished || globalThis.liveError, undefined, { timeout: 30000, polling: 100 });
    Object.assign(live, await page.evaluate(() => ({ error: liveError, raw, normalized, identity, transcripts, queueStatuses,
      lastDelivery, invocations, playbackBefore, playbackAfter: state(), timesAfter: [...document.querySelectorAll('video')].map(video => video.currentTime), visibilityEvents })), { peakRssKiB });
    observations.liveRuns.push(live); console.log(JSON.stringify({ live }));
    assert.deepEqual(live.playbackBefore, live.playbackAfter);
    assert.ok(live.playbackAfter.every(video => !video.paused && !video.muted));
    assert.deepEqual(live.visibilityEvents, []);
    if (round === 1) {
      assert.equal(live.error, "cancelled"); assert.deepEqual(live.transcripts, []);
      assert.equal(live.queueStatuses.at(-1).reason, "cancelled");
      assert.equal(live.queueStatuses.at(-1).queue.pendingAudioMs, 0);
      assert.ok(live.queueStatuses.at(-1).queue.droppedAudioMs > 0);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => raw.chunks), live.raw.chunks, "Stop must detach capture while both videos continue");
      continue;
    }
    assert.equal(live.error, undefined);
    if (periods === 1) assert.equal(live.transcripts.length, 1);
    if (periods === 3) assert.equal(live.transcripts.length, 2, "Long live input must return both pause-delimited bounded segments");
    assert.deepEqual(live.raw.rates, [48000]);
    assert.ok(live.raw.chunks > 100); assert.ok(live.raw.maxMapErrorMs < 150);
    const own = Math.sqrt(live.raw.selectedTagPower / live.raw.windows), other = Math.sqrt(live.raw.otherTagPower / live.raw.windows);
    assert.ok(Math.abs(own / 0.06 - 1) < 0.12, `Selected input tag: ${own}`); assert.ok(other < 0.003, `Unselected input tag: ${other}`);
    assert.equal(live.normalized.samples, Math.floor(live.raw.samples / 3));
    assert.equal(live.normalized.first.capture.clockId, live.raw.first.capture.clockId);
    assert.equal(live.normalized.first.audioRange.startMs, live.raw.first.audioRange.startMs);
    assert.ok(Math.abs(live.normalized.last.audioRange.endMs - live.raw.last.audioRange.endMs) < 0.0625);
    assert.ok(live.timesAfter.every(time => time >= clip.speechDurationSeconds * periods));
    assert.ok(live.queueStatuses.every(status => !status.reason && status.queue.droppedAudioMs === 0));
    assert.equal(live.queueStatuses.at(-1).queue.pendingAudioMs, 0);
    live.maxPendingAudioMs = Math.max(...live.queueStatuses.map(status => status.queue.pendingAudioMs));
    assert.ok(live.maxPendingAudioMs <= 30000);
    assert.equal(live.invocations.length, live.transcripts.length);
    for (const [i, revision] of live.transcripts.entries()) {
      assert.deepEqual(revision.identity, live.identity);
      assert.equal(revision.utteranceId, `speech-${i + 1}`);
      assert.equal(revision.final, true); assert.equal(revision.sourceRevision, 1); assert.equal(revision.language, language);
      if (i) assert.equal(revision.audioRange.startMs, live.transcripts[i - 1].audioRange.endMs);
      else {
        // The energy gate skips initial quiet frames before speech starts.
        assert.ok(revision.audioRange.startMs >= live.normalized.first.audioRange.startMs);
        assert.ok(revision.audioRange.startMs - live.normalized.first.audioRange.startMs <= 100);
      }
      assert.ok(revision.audioRange.endMs - revision.audioRange.startMs <= 20000);
      assert.deepEqual(live.invocations[i].audioRange, revision.audioRange);
      assert.equal(live.invocations[i].samples, Math.round((revision.audioRange.endMs - revision.audioRange.startMs) * 16));
      assert.ok(revision.mapped.endMs > revision.mapped.startMs);
    }
    // A final quiet frame after a full segment need not become an ASR job.
    // Non-quiet short remainders must still fail the zero-discard gate above.
    const trailingQuietMs = live.normalized.last.audioRange.endMs - live.transcripts.at(-1).audioRange.endMs;
    assert.ok(trailingQuietMs >= 0 && trailingQuietMs < 20);
    const text = live.transcripts.map(revision => revision.text).join(" ");
    live.accuracy = errors(Array(periods).fill(clip.text).join(" "), text, language);
    if (periods === 1) assert.ok(live.accuracy.rate <= 0.2, `Live selected-video ${language} ${live.accuracy.metric}: ${live.accuracy.rate}`);
    else if (live.accuracy.rate > 0.2) failures.push(`${language}/live-${periods}-periods: ${live.accuracy.metric} ${live.accuracy.rate} exceeds preserved 0.2 gate`);
    const anchors = language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
      : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
    const normalizedText = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, language === "ja" ? "" : " ");
    live.meaningCounts = Object.fromEntries(anchors.map(anchor => [anchor, normalizedText.split(anchor).length - 1]));
    if (periods === 1) assert.ok(anchors.every(anchor => text.includes(anchor)), "Live input must preserve negation/time/cancellation meaning");
    else if (Object.values(live.meaningCounts).some(count => count < periods)) failures.push(`${language}/live-${periods}-periods: missing repeated meaning anchors`);
    if (round === 4) {
      assert.equal(live.transcripts.length, 2, "Japanese live input must preserve both segments across its speech-band pause");
      assert.ok(live.invocations[0].deliveredAtEndMs > live.invocations[0].deliveredAtStartMs + 100,
        "Real selected-video capture must continue during actual ASR inference");
    }
    live.lastPacketToResultMs = live.transcripts.at(-1).observedAtMs - live.lastDelivery.atMs;
    if (periods === 1) assert.ok(live.lastPacketToResultMs >= 0 && live.lastPacketToResultMs < 2000);
    else if (!(live.lastPacketToResultMs >= 0 && live.lastPacketToResultMs < 2000)) failures.push(`${language}/live-${periods}-periods: last-packet-to-text ${live.lastPacketToResultMs} ms exceeds preserved latency gate`);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => raw.chunks), live.raw.chunks, "Capture must detach after completion while playback continues");
    console.log(JSON.stringify({ scoredLive: live }));
  }
  assert.deepEqual(pageErrors, []);
  await page.evaluate(() => host.dispose());
  // Preserve the five-period regression and add at least ten minutes per
  // language, with no appended silence. These are paced decoded samples,
  // not ten-minute live selected-video or translated-caption acceptance.
  observations.continuousRuns = [];
  await page.goto(origin); await page.waitForFunction(() => globalThis.makeHost);
  for (const { clip, repeats } of manifest.clips.flatMap(clip => [5, Math.ceil(600 / clip.speechDurationSeconds)].map(repeats => ({ clip, repeats })))) {
    const continuous = { language: clip.language, repeats, baselineRssKiB: await sampleRss() };
    peakRssKiB = continuous.baselineRssKiB;
    Object.assign(continuous, await prepare(clip.language));
    continuousMemory = { language: clip.language, repeats, start: performance.now(), samples: [] };
    Object.assign(continuous, await page.evaluate(async ({ clip, repeats }) => {
      const pcm = await readClip(clip);
      const combined = new Float32Array(pcm.length * repeats);
      for (let i = 0; i < repeats; i++) combined.set(pcm, i * pcm.length);
      const input = [];
      for (let offset = 0; offset < combined.length; offset += 1600)
        input.push(chunk(combined.slice(offset, offset + 1600), input.length, offset / 16));
      let quietSamples = 0, maxQuietSamples = 0;
      for (let offset = 0; offset < combined.length; offset += 320) {
        const frame = combined.subarray(offset, offset + 320);
        const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
        quietSamples = rms >= 0.01 ? 0 : quietSamples + frame.length;
        maxQuietSamples = Math.max(maxQuietSamples, quietSamples);
      }
      const invocations = []; const original = host.recognize;
      host.recognize = async job => {
        const invocation = { audioRange: { ...job.audioRange }, samples: job.pcm.length, atMs: performance.now() };
        invocations.push(invocation);
        try { return await original(job); }
        finally { invocation.settledAtMs = performance.now(); }
      };
      const start = performance.now();
      const outcome = await collect(paced(input)).then(() => "completed", error => error.message);
      return { outcome, inputSamplesPerSpeech: pcm.length, intendedSamples: combined.length,
        intendedDurationMs: combined.length / 16, maxQuietMs: maxQuietSamples / 16,
        hostDurationMs: performance.now() - start, invocations, transcripts, deliveryTimes,
        statuses: queueStatuses, visibilityEvents };
    }, { clip, repeats }), { peakRssKiB });
    continuous.memorySamples = continuousMemory.samples;
    continuousMemory = undefined;
    continuous.finalRssKiB = await sampleRss();
    continuous.maxPendingAudioMs = Math.max(...continuous.statuses.map(status => status.queue.pendingAudioMs));
    continuous.last = continuous.statuses.at(-1);
    // Do not score missing text as successful accuracy or accept an overload as
    // normal continuous playback. Still collect both languages before failing.
    if (continuous.outcome !== "completed") failures.push(`${clip.language}/continuous: ${continuous.outcome}`);
    else {
      continuous.accuracy = errors(Array(repeats).fill(clip.text).join(" "), continuous.transcripts.map(revision => revision.text).join(" "), clip.language);
      if (continuous.accuracy.rate > 0.2) failures.push(`${clip.language}/continuous: ${continuous.accuracy.metric} ${continuous.accuracy.rate} exceeds preserved 0.2 gate`);
      const anchors = clip.language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
        : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
      const text = continuous.transcripts.map(revision => revision.text).join(" ").normalize("NFKC").toLowerCase()
        .replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, clip.language === "ja" ? "" : " ");
      continuous.meaningCounts = Object.fromEntries(anchors.map(anchor => [anchor, text.split(anchor).length - 1]));
      if (Object.values(continuous.meaningCounts).some(count => count < repeats)) failures.push(`${clip.language}/continuous-${repeats}: missing repeated meaning anchors`);
      if (continuous.transcripts.length < Math.ceil(continuous.intendedDurationMs / 20000)
        || continuous.transcripts.length > Math.ceil(continuous.intendedDurationMs / 10000))
        failures.push(`${clip.language}/continuous: segment count must respect the 10–20 s boundary window`);
      for (const [i, revision] of continuous.transcripts.entries()) {
        assert.deepEqual(revision.identity, { sessionId: "fixture-stream", targetId: `fixture-${clip.language}`, epoch: 3 });
        assert.equal(revision.utteranceId, `speech-${i + 1}`); assert.equal(revision.final, true);
        assert.equal(revision.sourceRevision, 1); assert.equal(revision.language, clip.language);
        assert.equal(revision.audioRange.startMs, i ? continuous.transcripts[i - 1].audioRange.endMs : 0);
        const durationMs = revision.audioRange.endMs - revision.audioRange.startMs;
        assert.ok(durationMs <= 20000);
        if (i < continuous.transcripts.length - 1) assert.ok(durationMs >= 10000);
        assert.deepEqual(continuous.invocations[i].audioRange, revision.audioRange);
        assert.equal(continuous.invocations[i].samples, Math.round(durationMs * 16));
      }
      assert.equal(continuous.transcripts.at(-1)?.audioRange.endMs, continuous.intendedDurationMs);
      assert.equal(continuous.invocations.length, continuous.transcripts.length);
      if (repeats > 5) {
        assert.ok(continuous.intendedDurationMs >= 600000);
        assert.equal(continuous.deliveryTimes.at(-1).endMs, continuous.intendedDurationMs);
        assert.ok(continuous.hostDurationMs >= continuous.intendedDurationMs - 1, "Sustained input must actually run at real-time cadence");
        continuous.segmentLatenciesMs = continuous.transcripts.map(revision => {
          const delivered = continuous.deliveryTimes.find(packet => packet.endMs >= revision.audioRange.endMs);
          return revision.observedAtMs - delivered.atMs;
        });
        if (continuous.segmentLatenciesMs.some(latency => latency < 0 || latency >= 2000))
          failures.push(`${clip.language}/continuous-${repeats}: endpoint-to-text exceeds the existing 2000 ms long-input gate`);
        continuous.minuteQueues = Array.from({ length: Math.ceil(continuous.intendedDurationMs / 60000) }, (_, minute) => {
          const start = continuous.deliveryTimes[0].atMs - 100 + minute * 60000;
          const statuses = continuous.statuses.filter(status => status.atMs >= start && status.atMs < start + 60000);
          assert.ok(statuses.length, "Every sustained minute must report actual queue observations");
          return { minute: minute + 1, maxPendingAudioMs: Math.max(...statuses.map(status => status.queue.pendingAudioMs)),
            lastPendingAudioMs: statuses.at(-1).queue.pendingAudioMs, droppedAudioMs: statuses.at(-1).queue.droppedAudioMs };
        });
      }
    }
    if (continuous.statuses.some(status => status.queue.droppedAudioMs !== 0)) failures.push(`${clip.language}/continuous: discarded audio`);
    observations.continuousRuns.push(continuous); console.log(JSON.stringify({ continuous }));
    assert.ok(continuous.intendedDurationMs > 30000);
    assert.ok(continuous.maxQuietMs < 500, "Fixture must exercise the model bound rather than a silence endpoint");
    assert.ok(continuous.maxPendingAudioMs <= 30000);
    assert.equal(continuous.last.queue.pendingAudioMs, 0);
    assert.deepEqual(continuous.visibilityEvents, []);
    await page.evaluate(() => host.dispose());
  }
  observations.failures = failures;
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failures, [], "Live and continuous input must cross the model boundary without loss and preserve accuracy");
  observations.checks.push("Three paced utterances per language, bounded queue, semantic anchors and preserved CER/WER <= 0.2", "Silence-only input makes no ASR call; endpoints create no extra utterances", "Explicit unpaced overload/audio gap with discarded-duration status", "Real invocation-observed cancel and actual GPUDevice loss, no fallback");
  observations.checks.push("Live selected-element 48 kHz PCM → streaming 16 kHz normalization → real ASR, two audible videos, repeat Start, preserved accuracy/meaning, capture-clock/video mapping and playback state");
  observations.checks.push("Three live speech periods per language retain every meaning anchor and the aggregate CER/WER gate; Japanese capture continues during ASR across a speech-band pause boundary without loss");
  observations.checks.push("Five preserved speech periods per language cross 30 s at real-time cadence without loss and pass the unchanged aggregate CER/WER gate");
  observations.checks.push("At least ten minutes of paced decoded synthetic speech per language preserve every repeated meaning anchor and CER/WER <= 0.2, contiguous sample/range coverage, zero loss, bounded/drained queues and endpoint-to-text < 2000 ms; minute RSS/queue measurements are diagnostic, not live translation or leak qualification");
  observations.checks.push("Actual GPU loss during observed inference discards pending audio/text; same-host explicit cached Prepare and fresh-epoch Japanese/English recognition preserve accuracy without remote downloads or fallback");
  console.log(JSON.stringify({ passed: true, ...observations }));
} catch (error) {
  observations.documentState = await page?.evaluate(() => ({ visibility: document.visibilityState, visibilityEvents,
    prepared: globalThis.prepared, prepareError: globalThis.prepareError, lastStatus: statuses.at(-1),
    liveError: globalThis.liveError, finished: globalThis.finished, raw: globalThis.raw, normalized: globalThis.normalized,
    transcripts: globalThis.transcripts, lastQueueStatus: globalThis.queueStatuses?.at(-1),
    media: [...document.querySelectorAll('video')].map(video => ({time: video.currentTime, paused: video.paused,
      ended: video.ended, seeking: video.seeking, readyState: video.readyState, error: video.error?.message})) })).catch(failure => ({ error: failure.message }));
  console.error(JSON.stringify({ passed: false, ...observations, error: error.message })); throw error;
} finally {
  clearInterval(monitor);
  await browser?.close(); browserProcess?.kill("SIGTERM"); await browserExit;
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
