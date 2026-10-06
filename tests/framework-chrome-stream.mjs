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
      globalThis.makeRecognizer = (language) => {
        globalThis.queueStatuses = []; globalThis.transcripts = [];
        globalThis.identity = {sessionId: 'fixture-stream', targetId: 'fixture-'+language, epoch: 3};
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
  const pageErrors = []; const remotePaths = new Set();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { if (request.url().startsWith("https://")) { const url = new URL(request.url()); remotePaths.add(url.origin + url.pathname); } });
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
  observations.remotePaths = [...remotePaths]; observations.pageErrors = pageErrors; observations.failures = failures;
  observations.visibilityEvents = await page.evaluate(() => visibilityEvents);
  assert.ok([...remotePaths].every(path => /^https:\/\/huggingface.co\/(onnx-community\/whisper-small\/resolve\/36050c46d777d46dc4b5f43f6d90574fc38f8732\/|api\/resolve-cache\/models\/onnx-community\/whisper-small\/36050c46d777d46dc4b5f43f6d90574fc38f8732\/)/.test(path)
    || ["us.aws.cdn.hf.co", "cas-bridge.xethub.hf.co", "cas-server.xethub.hf.co"].includes(new URL(path).hostname)), "Only this pinned profile's model artifacts and storage redirects may be fetched");
  assert.deepEqual(pageErrors, []); assert.deepEqual(failures, [], "Preserved numerical accuracy gates must pass");
  observations.liveRuns = [];
  await page.goto(`${origin}/live`); await page.waitForFunction(() => globalThis.ready);
  for (const [round, language] of ["ja", "ja", "ja", "en"].entries()) {
    const clip = manifest.clips.find(clip => clip.language === language);
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    await page.evaluate(({ language, duration, round }) => configure(language, duration, round), { language, duration: clip.speechDurationSeconds, round });
    await page.locator("#prepare").click();
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 120000, polling: 100 });
    assert.equal(await page.evaluate(() => prepareError), undefined);
    const live = { round, language, baselineRssKiB: await sampleRss() }; peakRssKiB = live.baselineRssKiB;
    await page.locator("#start").click();
    if (round === 1) {
      await page.waitForFunction(() => normalized.chunks >= 20 || globalThis.liveError, undefined, { polling: 100 });
      await page.locator("#stop").click();
    }
    await page.waitForFunction(() => globalThis.finished || globalThis.liveError, undefined, { timeout: 30000, polling: 100 });
    Object.assign(live, await page.evaluate(() => ({ error: liveError, raw, normalized, identity, transcripts, queueStatuses,
      lastDelivery, playbackBefore, playbackAfter: state(), timesAfter: [...document.querySelectorAll('video')].map(video => video.currentTime), visibilityEvents })), { peakRssKiB });
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
    assert.equal(live.error, undefined); assert.equal(live.transcripts.length, 1);
    assert.deepEqual(live.raw.rates, [48000]);
    assert.ok(live.raw.chunks > 100); assert.ok(live.raw.maxMapErrorMs < 150);
    const own = Math.sqrt(live.raw.selectedTagPower / live.raw.windows), other = Math.sqrt(live.raw.otherTagPower / live.raw.windows);
    assert.ok(Math.abs(own / 0.06 - 1) < 0.12, `Selected input tag: ${own}`); assert.ok(other < 0.003, `Unselected input tag: ${other}`);
    assert.equal(live.normalized.samples, Math.floor(live.raw.samples / 3));
    assert.equal(live.normalized.first.capture.clockId, live.raw.first.capture.clockId);
    assert.equal(live.normalized.first.audioRange.startMs, live.raw.first.audioRange.startMs);
    assert.ok(Math.abs(live.normalized.last.audioRange.endMs - live.raw.last.audioRange.endMs) < 0.0625);
    assert.ok(live.timesAfter.every(time => time >= clip.speechDurationSeconds));
    assert.ok(live.queueStatuses.every(status => !status.reason && status.queue.droppedAudioMs === 0));
    assert.equal(live.queueStatuses.at(-1).queue.pendingAudioMs, 0);
    const revision = live.transcripts[0]; assert.deepEqual(revision.identity, live.identity);
    assert.equal(revision.final, true); assert.equal(revision.sourceRevision, 1); assert.equal(revision.language, language);
    live.accuracy = errors(clip.text, revision.text, language);
    assert.ok(live.accuracy.rate <= 0.2, `Live selected-video ${language} ${live.accuracy.metric}: ${live.accuracy.rate}`);
    const anchors = language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
      : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
    assert.ok(anchors.every(anchor => revision.text.includes(anchor)), "Live input must preserve negation/time/cancellation meaning");
    live.lastPacketToResultMs = revision.observedAtMs - live.lastDelivery.atMs;
    assert.ok(live.lastPacketToResultMs >= 0 && live.lastPacketToResultMs < 2000);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => raw.chunks), live.raw.chunks, "Capture must detach after completion while playback continues");
  }
  assert.deepEqual(pageErrors, []);
  await page.evaluate(() => host.dispose());
  observations.checks.push("Three paced utterances per language, bounded queue, semantic anchors and preserved CER/WER <= 0.2", "Silence-only input makes no ASR call; endpoints create no extra utterances", "Explicit unpaced overload/audio gap with discarded-duration status", "Real invocation-observed cancel and actual GPUDevice loss, no fallback");
  observations.checks.push("Live selected-element 48 kHz PCM → streaming 16 kHz normalization → real ASR, two audible videos, repeat Start, preserved accuracy/meaning, capture-clock/video mapping and playback state");
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
