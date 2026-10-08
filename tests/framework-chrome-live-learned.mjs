import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { build } from "vite";

// B2 learned live-input qualification only; no Korean translation/caption DOM.
const output = resolve(".ralph/media-framework/chrome-live-learned-build");
const manifest = JSON.parse(await readFile("tests/fixtures/video-speech/manifest.json", "utf8"));
for (const clip of manifest.clips) {
  const bytes = await readFile(`tests/fixtures/video-speech/${clip.language}.webm`);
  assert.equal(bytes.length, clip.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), clip.sha256);
}
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: { input: { asr: resolve("packages/engines-browser/asr-host.ts"), speech: resolve("packages/engines-browser/speech-recognizer.ts"),
    normalize: resolve("packages/engines-browser/normalize-audio.ts"), input: resolve("packages/media-web/audio-input.ts"),
    catalog: resolve("packages/media-web/catalog.ts"), timeline: resolve("packages/core/timeline.ts"), vad: resolve("packages/engines-browser/vad-host.ts") },
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
const observations = { scope: "B2 learned WASM VAD and FP16 WebGPU ASR over live selected-video PCM; no translation/caption DOM", liveRuns: [], failures: [] };
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
  peakRssKiB = Math.max(peakRssKiB, rss);
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
  profile = await mkdtemp(resolve(".ralph/media-framework/chrome-live-learned-profile-"));
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
  page.context().on("request", request => { if (request.url().startsWith("https://")) { remoteRequests++; const url = new URL(request.url()); remotePaths.add(url.origin + url.pathname); } });
  monitor = setInterval(() => { void sampleRss().catch(() => {}); }, 250);
  await page.goto(`${origin}/live`); await page.waitForFunction(() => globalThis.ready);
  observations.baselineRssKiB = await sampleRss();
  for (const [round, language] of ["ja", "ja", "ja", "en", "ja", "en"].entries()) {
    const clip = manifest.clips.find(clip => clip.language === language);
    const periods = round >= 4 ? 3 : 1;
    await page.bringToFront(); assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    await page.evaluate(({ language, duration, round }) => configure(language, duration, round, true), { language, duration: clip.speechDurationSeconds * periods, round });
    // Keep trusted activation without moving the pointer beside native media
    // volume controls; playback-state equality remains required in every round.
    const preparationStart = performance.now();
    await page.locator("#prepare").press("Enter");
    await page.waitForFunction(() => globalThis.prepared || globalThis.prepareError, undefined, { timeout: 120000, polling: 100 });
    assert.equal(await page.evaluate(() => prepareError), undefined);
    const live = { round, language, periods, preparationMs: performance.now()-preparationStart, baselineRssKiB: await sampleRss() }; peakRssKiB = live.baselineRssKiB;
    await page.locator("#start").press("Enter");
    if (round === 1) {
      await page.waitForFunction(() => normalized.chunks >= 20 || globalThis.liveError, undefined, { polling: 100 });
      await page.locator("#stop").press("Enter");
    }
    await page.waitForFunction(() => globalThis.finished || globalThis.liveError, undefined, { timeout: 30000, polling: 100 });
    Object.assign(live, await page.evaluate(() => ({ error: liveError, raw, normalized, identity, transcripts, queueStatuses,
      lastDelivery, invocations, statuses, vadStatuses, detectorFrames, playbackBefore, playbackAfter: state(), timesAfter: [...document.querySelectorAll('video')].map(video => video.currentTime), visibilityEvents })), { peakRssKiB, finalRssKiB: await sampleRss() });
    observations.liveRuns.push(live);
    assert.equal(live.statuses.at(-1).state, "ready");
    assert.equal(live.statuses.at(-1).requiredBytes, 487960440);
    assert.equal(live.vadStatuses.at(-1).state, "ready");
    assert.equal(live.vadStatuses.at(-1).requiredBytes, 2243022);
    if (round) {
      for (const statuses of [live.statuses, live.vadStatuses]) {
        assert.ok(statuses.some(status => status.state === "cached"));
        assert.ok(statuses.every(status => status.state !== "downloading"));
      }
    }
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
      assert.ok(live.detectorFrames.length > 0, "Stop must interrupt real learned live processing");
      console.log(JSON.stringify({ live }));
      continue;
    }
    assert.equal(live.error, undefined);
    if (periods === 1) assert.equal(live.transcripts.length, 1);
    assert.ok(live.invocations.every(job => job.exactInput), "ASR jobs must equal their actual normalized selected-video samples");
    assert.equal(live.detectorFrames.length, Math.ceil(live.normalized.samples/512));
    let covered = 0;
    for (const frame of live.detectorFrames) {
      assert.equal(frame.startSample, covered); covered += frame.samples;
      assert.equal(frame.paddingSamples, 512-frame.samples);
    }
    assert.equal(covered, live.normalized.samples);
    live.detectorInferenceMs = live.detectorFrames.reduce((sum, frame) => sum+frame.inferenceMs, 0);
    assert.ok(live.detectorInferenceMs < live.normalized.samples/16*0.1);
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
    // Count the admitted contiguous window; the separately bounded leading
    // and trailing quiet context must not demand a fabricated extra utterance.
    live.coveredAudioMs = live.transcripts.at(-1).audioRange.endMs - live.transcripts[0].audioRange.startMs;
    if (live.transcripts.length < Math.ceil(live.coveredAudioMs / 20000)) observations.failures.push(`${language}/live-${periods}-periods: live input must cross the 20 s segment bound`);
    live.trailingQuietMs = trailingQuietMs;
    if (!(trailingQuietMs >= 0 && trailingQuietMs < 20)) observations.failures.push(`${language}/live-${periods}-periods: trailing context ${trailingQuietMs} ms exceeds the preserved <20 ms gate`);
    const text = live.transcripts.map(revision => revision.text).join(" ");
    live.accuracy = errors(Array(periods).fill(clip.text).join(" "), text, language);
    if (periods === 1) assert.ok(live.accuracy.rate <= 0.2, `Live selected-video ${language} ${live.accuracy.metric}: ${live.accuracy.rate}`);
    else if (live.accuracy.rate > 0.2) observations.failures.push(`${language}/live-${periods}-periods: ${live.accuracy.metric} ${live.accuracy.rate} exceeds preserved 0.2 gate`);
    const anchors = language === "ja" ? ["会議", "しません", "明日", "午後", "駅", "予約", "取り消さない"]
      : ["not meet today", "station tomorrow", "in the afternoon", "not cancel the reservation"];
    const normalizedText = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, language === "ja" ? "" : " ");
    live.meaningCounts = Object.fromEntries(anchors.map(anchor => [anchor, normalizedText.split(anchor).length - 1]));
    if (Object.values(live.meaningCounts).some(count => count !== periods)) observations.failures.push(`${language}/live-${periods}-periods: every meaning must occur exactly ${periods} times`);
    if (round === 4) {
      assert.ok(live.invocations[0].deliveredAtEndMs > live.invocations[0].deliveredAtStartMs + 100,
        "Real selected-video capture must continue during actual ASR inference");
    }
    live.lastPacketToResultMs = live.transcripts.at(-1).observedAtMs - live.lastDelivery.atMs;
    if (periods === 1) assert.ok(live.lastPacketToResultMs >= 0 && live.lastPacketToResultMs < 2000);
    else if (!(live.lastPacketToResultMs >= 0 && live.lastPacketToResultMs < 2000)) observations.failures.push(`${language}/live-${periods}-periods: last-packet-to-text ${live.lastPacketToResultMs} ms exceeds preserved latency gate`);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => raw.chunks), live.raw.chunks, "Capture must detach after completion while playback continues");
    console.log(JSON.stringify({ scoredLive: live }));
  }
  observations.pageErrors = pageErrors;
  observations.remotePaths = [...remotePaths];
  observations.remoteRequests = remoteRequests;
  const pinned = "https://huggingface.co/onnx-community/whisper-small/resolve/36050c46d777d46dc4b5f43f6d90574fc38f8732/";
  const vadPinned = "https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx";
  assert.ok(remotePaths.has(vadPinned));
  assert.equal([...remotePaths].filter(path => path.startsWith(pinned)).length, 7);
  assert.ok([...remotePaths].every(path => path.startsWith(pinned)
    || path.startsWith("https://huggingface.co/api/resolve-cache/models/onnx-community/whisper-small/36050c46d777d46dc4b5f43f6d90574fc38f8732/")
    || path === vadPinned || path.startsWith("https://huggingface.co/api/resolve-cache/models/onnx-community/silero-vad/e71cae966052b992a7eca6b17738916ce0eca4ec/")
    || path.startsWith("https://us.aws.cdn.hf.co/xet-bridge-us/")), "Only pinned model artifacts/redirects may be remote");
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ passed: observations.failures.length === 0, ...observations }));
  assert.deepEqual(observations.failures, [], "Learned live input must preserve accuracy, every meaning and latency");
} catch (error) {
  observations.documentState = await page?.evaluate(() => ({ visibility: document.visibilityState, visibilityEvents,
    prepared: globalThis.prepared, prepareError: globalThis.prepareError, lastStatus: statuses.at(-1),
    lastVadStatus: vadStatuses.at(-1), liveError: globalThis.liveError, finished: globalThis.finished,
    raw, normalized, detectorFrames, transcripts, lastQueueStatus: queueStatuses.at(-1),
    media: [...document.querySelectorAll('video')].map(video => ({time: video.currentTime, paused: video.paused,
      ended: video.ended, seeking: video.seeking, readyState: video.readyState, error: video.error?.message})) })).catch(failure => ({ error: failure.message }));
  console.error(JSON.stringify({ passed: false, ...observations, error: error.message })); throw error;
} finally {
  clearInterval(monitor);
  await browser?.close(); browserProcess?.kill("SIGTERM"); await browserExit;
  if (profile) await rm(profile, { recursive: true, force: true });
  await new Promise(done => server.close(done));
}
