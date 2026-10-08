import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";
import { validAsrJob } from "../packages/engines-browser/asr-protocol.ts";
import { asrCandidates, registeredCandidate } from "../packages/engines-browser/model.ts";

// Compare candidates on identical captured jobs, without regenerating input or
// replacing the original live accuracy/endpoint acceptance with replay timing.
const extensionInput = process.argv[3] === "--extension-input";
const defaultOnly = extensionInput || process.argv[3] === "--default-only";
assert.equal(process.argv.length, defaultOnly ? 4 : 3, "Supply one synthetic live-job archive directory");
const archive = resolve(process.argv[2]);
assert.ok(archive.startsWith(resolve(extensionInput ? ".ralph/media-framework/chrome-extension-jobs-" : ".ralph/media-framework/chrome-live-jobs-")));
const captured = JSON.parse(await readFile(resolve(archive, "manifest.json"), "utf8"));
assert.equal(captured.scope, extensionInput
  ? "Owned synthetic production-extension ASR inputs; replay reproducibility only, not whole-run accuracy or endpoint acceptance"
  : "Owned synthetic selected-video ASR jobs only; no user recordings or full interpretation");
if (defaultOnly) assert.equal(captured.candidate, "smallFp16");
assert.equal(captured.format, "float32-le"); assert.equal(captured.sampleRate, 16000); assert.equal(captured.channels, 1);
const original = registeredCandidate(asrCandidates[captured.candidate].model, asrCandidates[captured.candidate].dtype);
assert.deepEqual(captured.model, { ...original.model, requiredBytes: original.requiredBytes });
const fixtures = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
for (const clip of fixtures.clips) {
  const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
  assert.equal(bytes.length, clip.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
  assert.ok(captured.runs.some(run => run.language === clip.language), "Replay both original languages");
}
assert.ok(captured.runs.length > 0);
const files = new Set();
for (const run of captured.runs) {
  const clip = fixtures.clips.find(clip => clip.language === run.language);
  assert.equal(run.reference, clip.text); assert.equal(run.fixtureSha256, clip.sha256);
  if (extensionInput) {
    assert.ok(["online", "offline-restart", "sustained"].includes(run.mode));
    assert.equal(run.referenceScope, "Original labeled phrase only; remux repeats truncated encoded periods, so whole-run reference/counts are not established");
    if (run.mode === "sustained") {
      const { repeatSpeechVideo } = await import("./fixtures/video-speech/repeat.mjs");
      const remux = repeatSpeechVideo(await readFile(`tests/fixtures/video-speech/${run.language}.webm`), 26);
      assert.deepEqual(run.generatedMedia, { language: run.language, periods: 26, periodMs: remux.periodMs,
        packets: remux.packets, bytes: remux.bytes.length, sha256: createHash("sha256").update(remux.bytes).digest("hex"), originalSha256: clip.sha256 });
    }
  } else assert.ok(Number.isSafeInteger(run.periods) && run.periods > 0);
  assert.ok(run.jobs.length > 0);
  for (const [index, job] of run.jobs.entries()) {
    assert.equal(job.file, basename(job.file)); assert.ok(!files.has(job.file)); files.add(job.file);
    const bytes = await readFile(resolve(archive, job.file));
    assert.equal(bytes.length, job.samples*4);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), job.inputSha256);
    const pcm = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
    assert.ok(validAsrJob({ ...job, identity: run.identity, language: run.language, pcm }));
    assert.ok(job.audioRange.endMs-job.audioRange.startMs <= 20000);
    assert.equal(job.utteranceId, `speech-${index+1}`);
    if (index) assert.equal(job.audioRange.startMs, run.jobs[index-1].audioRange.endMs);
    assert.equal(typeof job.originalText, "string");
  }
}
const output = resolve(".ralph/media-framework/chrome-replay-build");
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: { asr: resolve("packages/engines-browser/asr-host.ts"),
    "trace-worker": resolve("tests/fixtures/browser-asr-trace-worker.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare">Prepare</button><script type="module">
      import {createAsrHost} from '/asr.js';
      const NativeWorker = Worker; globalThis.workerCount = 0; globalThis.decodeTraces = [];
      globalThis.Worker = class extends NativeWorker {
        constructor(url, options) {
          if (!new URL(url, location.href).pathname.includes('asr-worker')) throw new Error('Expected production ASR worker');
          super('/trace-worker.js', options); workerCount++;
          this.addEventListener('message', event => {
            if (event.data.type === 'result') decodeTraces.push(event.data.decodeTrace);
          });
        }
      };
      globalThis.visibilityEvents = [];
      document.addEventListener('visibilitychange', () => visibilityEvents.push(document.visibilityState));
      globalThis.makeHost = candidate => {
        globalThis.host?.dispose(); globalThis.statuses = []; globalThis.prepared = false; globalThis.prepareError = undefined;
        globalThis.host = createAsrHost(document, candidate, 'webgpu', status => statuses.push(status));
      };
      document.querySelector('button').onclick = () => {
        host.prepare().then(() => {globalThis.prepared = true}, error => {globalThis.prepareError = error.message});
      };
      globalThis.replayJob = async ({job, base64}) => {
        const pcm = new Float32Array(Uint8Array.from(atob(base64), byte => byte.charCodeAt(0)).buffer);
        const littleEndian = new Uint8Array(new Float32Array([1]).buffer)[3] === 63;
        if (!littleEndian) throw new Error('Replay requires Float32 little-endian');
        const digest = crypto.subtle.digest('SHA-256', pcm);
        decodeTraces.length = 0;
        const started = performance.now(); const output = await host.recognize({...job, pcm});
        const hostRoundTripMs = performance.now()-started;
        if (decodeTraces.length !== 1) throw new Error('Expected exactly one traced production result');
        return {...output, hostRoundTripMs, transferredBytes: pcm.byteLength,
          decodeTrace: decodeTraces[0],
          inputSha256: [...new Uint8Array(await digest)].map(byte => byte.toString(16).padStart(2,'0')).join('')};
      };
      window.addEventListener('pagehide', () => host?.dispose());
    </script>`); return;
  }
  const file = resolve(output, `.${path}`);
  if (!file.startsWith(output+sep)) { response.writeHead(403); response.end(); return; }
  try {
    const bytes = await readFile(file);
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" })[extname(file)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable"); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const observations = { scope: extensionInput
  ? "B6 exact production-extension synthetic ASR input replay/decoder traces; no new capture, whole-run accuracy, native translation or endpoint qualification"
  : defaultOnly ? "B6 default-profile exact archived ASR replay/decoder traces and original accuracy/meaning gates; no live endpoint or translation qualification"
  : "B2 exact archived synthetic selected-video ASR candidate comparison; no live capture/VAD/endpoint/translation/DOM qualification",
  archive, archiveManifestSha256: createHash("sha256").update(await readFile(resolve(archive, "manifest.json"))).digest("hex"),
  originalModel: captured.model, archivedJobs: files.size, trials: [], failures: [] };
let browser; let browserProcess; let browserExit; let profile; let monitor; let page; let peakRssKiB = 0;
const execute = promisify(execFile);
async function sampleRss() {
  const { stdout } = await execute("ps", ["-axo", "pid=,ppid=,rss="]);
  const processes = stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([browserProcess.pid]);
  for (let added = true; added;) {
    added = false;
    for (const [pid, parent] of processes) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); added = true; }
  }
  const rss = processes.filter(([pid]) => owned.has(pid)).reduce((sum, [, , memory]) => sum+memory, 0);
  peakRssKiB = Math.max(peakRssKiB, rss); return rss;
}
function errors(reference, hypothesis, language) {
  const normalize = text => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
  const ref = language === "ja" ? [...normalize(reference).replace(/ /g, "")] : normalize(reference).split(" ");
  const hyp = language === "ja" ? [...normalize(hypothesis).replace(/ /g, "")] : normalize(hypothesis).split(" ");
  let previous = Array.from({ length: hyp.length+1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) row[j] = Math.min(previous[j]+1, row[j-1]+1, previous[j-1]+(ref[i-1] === hyp[j-1] ? 0 : 1));
    previous = row;
  }
  return { metric: language === "ja" ? "CER" : "WER", edits: previous[hyp.length], referenceUnits: ref.length, rate: previous[hyp.length]/ref.length };
}
try {
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-replay-profile-"));
  browserProcess = spawn(chromium.executablePath(), ["--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  browserExit = new Promise(done => { browserProcess.once("exit", done); browserProcess.once("error", done); });
  let port; const deadline = performance.now()+10000;
  while (performance.now() < deadline && browserProcess.exitCode === null) {
    try { port = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert.ok(port, "Owned Chromium must expose its local debugging endpoint");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  observations.browser = browser.version(); observations.platform = `${process.platform}/${process.arch}`;
  observations.memoryMetric = "Owned browser tree RSS KiB / 250ms sampling; shared pages, allocator, browser/GPU/model included; no isolated allocation/pressure/leak qualification";
  page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(10000);
  const pageErrors = []; const remotePaths = new Set(); let remoteRequests = 0;
  page.on("pageerror", error => pageErrors.push(error.message));
  page.context().on("request", request => {
    if (request.url().startsWith("https://")) { remoteRequests++; const url = new URL(request.url()); remotePaths.add(url.origin+url.pathname); }
  });
  monitor = setInterval(() => { void sampleRss().catch(() => {}); }, 250);
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => globalThis.makeHost);
  observations.baselineRssKiB = await sampleRss();
  for (const candidate of defaultOnly ? ["smallFp16"] : ["smallFp16", "turboFp16", "smallTimestamped"]) for (const trial of [1, 2]) {
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    await page.evaluate(candidate => makeHost(candidate), candidate);
    const workersBefore = await page.evaluate(() => workerCount);
    const selected = registeredCandidate(asrCandidates[candidate].model, asrCandidates[candidate].dtype);
    const measured = { candidate, trial, dtype: selected.dtype, model: selected.model, requiredBytes: selected.requiredBytes, runs: [] };
    observations.trials.push(measured);
    measured.baselineRssKiB = await sampleRss(); peakRssKiB = measured.baselineRssKiB;
    const requestsBefore = remoteRequests; const started = performance.now();
    await page.locator("#prepare").press("Enter");
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 240000, polling: 100 });
    assert.equal(await page.evaluate(() => prepareError), undefined);
    measured.preparationMs = performance.now()-started; measured.preparationRemoteRequests = remoteRequests-requestsBefore;
    measured.statuses = await page.evaluate(() => statuses);
    assert.equal(await page.evaluate(() => workerCount), workersBefore+1, "Each trial requires a fresh production worker");
    assert.deepEqual(measured.statuses.at(-1).model, selected.model); assert.equal(measured.statuses.at(-1).state, "ready");
    if (trial === 2) {
      assert.equal(measured.preparationRemoteRequests, 0); assert.ok(measured.statuses.some(status => status.state === "cached"));
      assert.ok(measured.statuses.every(status => status.state !== "downloading"));
    }
    console.log(JSON.stringify({ replayPreparation: measured }));
    const inferenceRequestsBefore = remoteRequests;
    for (const run of captured.runs) {
      const replay = { round: run.round, language: run.language, periods: run.periods, jobs: [] };
      measured.runs.push(replay);
      for (const job of run.jobs) {
        const bytes = await readFile(resolve(archive, job.file));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), job.inputSha256);
        const result = await page.evaluate(snapshot => replayJob(snapshot), {
          job: { identity: run.identity, utteranceId: job.utteranceId, language: run.language, audioRange: job.audioRange }, base64: bytes.toString("base64"),
        });
        assert.equal(result.inputSha256, job.inputSha256); assert.equal(result.transferredBytes, 0);
        assert.deepEqual(result.revision.identity, run.identity); assert.deepEqual(result.revision.audioRange, job.audioRange);
        assert.equal(result.revision.utteranceId, job.utteranceId); assert.equal(result.revision.language, run.language);
        assert.equal(result.revision.sourceRevision, 1); assert.equal(result.revision.final, true);
        assert.ok(Number.isFinite(result.inferenceMs) && result.inferenceMs >= 0);
        assert.ok(Number.isFinite(result.hostRoundTripMs) && result.hostRoundTripMs >= result.inferenceMs);
        const trace = result.decodeTrace;
        assert.equal(trace.decodedText, result.revision.text);
        assert.equal(trace.inputs.length, 1, "The original single-pass job must stay single-pass");
        assert.deepEqual(trace.inputs[0].stride, [job.samples/16000, 0, 0]);
        assert.ok(Number.isSafeInteger(trace.timestampBegin) && trace.timestampBegin > 0);
        assert.equal(trace.timePrecision, 0.02);
        assert.ok(trace.inputs[0].tokens.length > 0 && trace.inputs[0].tokens.length <= 259);
        assert.ok(trace.inputs[0].tokens.every(token => Number.isSafeInteger(token) && token >= 0));
        assert.equal(typeof trace.inputs[0].rawText, "string");
        assert.ok(Array.isArray(trace.decoded.chunks));
        replay.jobs.push({ ...job, ...result, identicalOriginalText: result.revision.text === job.originalText });
      }
      if (extensionInput) {
        replay.identicalOriginalJobs = replay.jobs.filter(job => job.identicalOriginalText).length;
        if (replay.identicalOriginalJobs !== run.jobs.length) observations.failures.push(`default/trial-${trial}/round-${run.round}: original ASR output was not reproduced for every unchanged job`);
        replay.wholeRunAccuracy = "UNVERIFIED: no complete reference for truncated remux speech";
        console.log(JSON.stringify({ candidate, trial, exactReplay: replay }));
        continue;
      }
      const text = replay.jobs.map(job => job.revision.text).join(" ");
      replay.accuracy = errors(Array(run.periods).fill(run.reference).join(" "), text, run.language);
      const anchors = run.language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
        : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
      const normalized = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, run.language === "ja" ? "" : " ");
      replay.meaningCounts = Object.fromEntries(anchors.map(anchor => [anchor, normalized.split(anchor).length-1]));
      if (replay.accuracy.rate > 0.2) observations.failures.push(`${candidate}/trial-${trial}/round-${run.round}: ${replay.accuracy.metric} exceeds preserved 0.2 gate`);
      if (Object.values(replay.meaningCounts).some(count => count !== run.periods)) observations.failures.push(`${candidate}/trial-${trial}/round-${run.round}: every meaning must occur exactly ${run.periods} times`);
      console.log(JSON.stringify({ candidate, trial, exactReplay: replay }));
    }
    measured.inferenceRemoteRequests = remoteRequests-inferenceRequestsBefore; assert.equal(measured.inferenceRemoteRequests, 0);
    measured.peakRssKiB = peakRssKiB;
    await page.evaluate(() => host.dispose());
    console.log(JSON.stringify({ replayTrial: measured }));
  }
  observations.remoteRequests = remoteRequests; observations.remotePaths = [...remotePaths]; observations.pageErrors = pageErrors;
  observations.visibilityEvents = await page.evaluate(() => visibilityEvents);
  assert.deepEqual(pageErrors, []); assert.deepEqual(observations.visibilityEvents, []);
  assert.ok([...remotePaths].every(path => ["smallFp16", "turboFp16", "smallTimestamped"].some(candidate => {
    const { model } = asrCandidates[candidate];
    return path.startsWith(`https://huggingface.co/${model.id}/resolve/${model.version}/`)
      || path.startsWith(`https://huggingface.co/api/resolve-cache/models/${model.id}/${model.version}/`);
  }) || path.startsWith("https://us.aws.cdn.hf.co/xet-bridge-us/")), "Only pinned model artifacts/redirects may be remote");
  console.log(JSON.stringify({ passed: observations.failures.length === 0, ...observations }));
  assert.deepEqual(observations.failures, [], extensionInput
    ? "Every captured production job must reproduce its original output in both fresh default-worker trials"
    : "Every archived run and candidate must pass unchanged accuracy/meaning gates");
} catch (error) {
  observations.documentState = await page?.evaluate(() => ({ visibility: document.visibilityState, visibilityEvents,
    prepared: globalThis.prepared, prepareError: globalThis.prepareError, lastStatus: statuses.at(-1) })).catch(failure => ({ error: failure.message }));
  console.error(JSON.stringify({ passed: false, ...observations, error: error.message })); throw error;
} finally {
  clearInterval(monitor);
  await browser?.close(); browserProcess?.kill("SIGTERM"); await browserExit;
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
