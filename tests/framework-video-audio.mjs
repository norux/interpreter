// Real encoded video -> selected-element Web Audio PCM, with an independent tab-output oracle.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";
import { verifyVideoTimeline } from "./framework-video-timeline.mjs";

const output = resolve(".ralph/media-framework/video-audio-build");
await build({ configFile: false, logLevel: "warn", build: {
  outDir: output, emptyOutDir: true, minify: false,
  rollupOptions: { input: { input: resolve("packages/media-web/audio-input.ts"), catalog: resolve("packages/media-web/catalog.ts"),
    controller: resolve("packages/core/session-controller.ts"), timeline: resolve("packages/core/timeline.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js", chunkFileNames: "[name]-[hash].js" } },
} });
let media;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/tone.webm" || path === "/replacement.webm") {
    response.setHeader("Content-Type", "video/webm"); response.setHeader("Accept-Ranges", "bytes");
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    if (start > end) { response.writeHead(416, { "Content-Range": `bytes */${media.length}` }); response.end(); return; }
    if (range) { response.statusCode = 206; response.setHeader("Content-Range", `bytes ${start}-${end}/${media.length}`); }
    response.setHeader("Content-Length", end - start + 1); response.end(media.subarray(start, end + 1));
  }
  else if (path === "/pcm-worklet.js") { response.setHeader("Content-Type", "text/javascript"); response.end(await readFile("packages/media-web/pcm-worklet.js")); }
  else if (/^\/[\w-]+\.js$/.test(path)) { response.setHeader("Content-Type", "text/javascript"); response.end(await readFile(resolve(output, path.slice(1)))); }
  else if (path === "/timeline") { response.setHeader("Content-Type", "text/html"); response.end(await readFile("tests/fixtures/video-timeline.html")); }
  else if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end(await readFile("tests/fixtures/video-audio.html")); }
  else { response.setHeader("Content-Type", "text/html"); response.end("<button>Generate</button>"); }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", headless: true, ignoreDefaultArgs: ["--mute-audio"],
    args: ["--auto-select-tab-capture-source-by-title=Video audio acceptance", "--enable-usermedia-screen-capturing"] });
  const generator = await browser.newPage();
  await generator.goto(`http://127.0.0.1:${server.address().port}/generate`);
  await generator.getByRole("button").click();
  const encoded = await generator.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const draw = () => { canvas.getContext("2d").fillStyle = "#426"; canvas.getContext("2d").fillRect(0, 0, 160, 90); };
    draw(); const timer = setInterval(draw, 100);
    const context = new AudioContext({ sampleRate: 48000 });
    const oscillator = context.createOscillator(); oscillator.frequency.value = 440;
    const gain = context.createGain(); gain.gain.value = 0.15;
    const destination = context.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
    const stream = canvas.captureStream(10);
    stream.addTrack(destination.stream.getAudioTracks()[0]);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    const parts = []; recorder.ondataavailable = ({ data }) => parts.push(data);
    const stopped = new Promise((done) => { recorder.onstop = done; });
    recorder.start(); await new Promise((done) => setTimeout(done, 8000)); recorder.stop(); await stopped;
    clearInterval(timer); oscillator.stop(); stream.getTracks().forEach((track) => { track.stop(); }); await context.close();
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    let text = ""; for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  });
  media = Buffer.from(encoded, "base64");
  assert.ok(media.length > 10000, `A real encoded video/audio fixture must exist (${media.length} bytes)`);
  await generator.close();
  const observations = [];
  for (const owned of [false, true]) {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?owned=${owned}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.getByRole("button", { name: "Play and observe output" }).click();
    await page.waitForFunction(() => globalThis.outputReady || globalThis.outputError, undefined, { timeout: 10000 });
    const outputError = await page.evaluate(() => globalThis.outputError);
    assert.equal(outputError, undefined, `Independent browser output capture unavailable: ${outputError}`);
    const settings = await page.evaluate(() => globalThis.outputSettings);
    assert.equal(settings.autoGainControl, false); assert.equal(settings.echoCancellation, false);
    assert.equal(settings.noiseSuppression, false); assert.equal(settings.suppressLocalAudioPlayback, false);
    assert.deepEqual(await page.evaluate(() => [video.videoWidth, video.videoHeight]), [160, 90]);
    const baseline = await page.evaluate(() => globalThis.measureOutput());
    assert.ok(Math.abs(baseline.rms / (0.15 * 0.4 / Math.sqrt(2)) - 1) < 0.12, "Output oracle must measure the encoded tone at the original user volume");
    assert.ok(baseline.rms > 0.015, `Original playback must have real output samples: ${JSON.stringify(baseline)}`);
    const rounds = [];
    const initialTime = await page.evaluate(() => video.currentTime);
    for (let round = 0; round < 3; round++) {
      await page.getByRole("button", { name: "Start selected capture", exact: true }).click();
      await page.waitForFunction(() => globalThis.captured.length >= 5 || globalThis.captureError);
      assert.equal(await page.evaluate(() => globalThis.captureError), undefined);
      const result = await page.evaluate(() => globalThis.captureSummary());
      const anchors = await page.evaluate(() => globalThis.playbackEvents);
      assert.equal(anchors[0]?.type, "play", "Real PCM must be preceded by a playback anchor");
      assert.match(result.doubleStart, /already has an active session/);
      assert.equal(result.scope, "selected-video"); assert.equal(result.channels, 1); assert.equal(result.format, "pcm-f32le");
      assert.ok(result.peak > 0.12 && result.peak < 0.18, `Real decoded tone PCM: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.frequency - 440) < 12, `Selected video's tone: ${JSON.stringify(result)}`);
      assert.ok(result.chunks >= 5); assert.equal(result.identity.sessionId, `round-${round + 1}`);
      assert.equal(result.sequence[0], 0); assert.equal(result.byteLengths.every((length) => length === 8192), true);
      const during = await page.evaluate(() => globalThis.measureOutput());
      assert.ok(Math.abs(during.rms / baseline.rms - 1) < 0.12, `Capture must not double/mute original output: ${JSON.stringify({owned, round, baseline, during})}`);
      await page.getByRole("button", { name: "Stop selected capture", exact: true }).click();
      await page.waitForFunction(() => globalThis.captureClosed);
      const count = await page.evaluate(() => globalThis.captured.length);
      const after = await page.evaluate(() => globalThis.measureOutput());
      assert.equal(await page.evaluate(() => globalThis.captured.length), count, "Stop releases PCM delivery");
      assert.ok(Math.abs(after.rms / baseline.rms - 1) < 0.12, `Original output survives Stop/repeat Start at the same level: ${JSON.stringify({owned, round, baseline, after})}`);
      assert.deepEqual(await page.evaluate(() => ({ paused: video.paused, volume: video.volume, muted: video.muted, rate: video.playbackRate })),
        { paused: false, volume: 0.4, muted: false, rate: 1 });
      rounds.push({ ...result, duringOutputRms: during.rms, afterOutputRms: after.rms });
    }
    assert.ok(await page.evaluate((initialTime) => video.currentTime > initialTime + 1, initialTime), "Original playback advances through Start/Stop");
    // Slow consumer must fail visibly rather than silently stitching audio across a loss.
    await page.getByRole("button", { name: "Start slow capture", exact: true }).click();
    await page.waitForFunction(() => globalThis.slowReady);
    const overflow = await page.evaluate(async () => {
      await new Promise((done) => setTimeout(done, 350));
      try { await globalThis.slow.events[Symbol.asyncIterator]().next(); return "no failure"; }
      catch (error) { return error.message; }
    });
    assert.match(overflow, /^audio-gap: Video input queue overflow/);
    assert.ok((await page.evaluate(() => globalThis.measureOutput())).rms > 0.015);
    assert.deepEqual(errors, []);
    observations.push({ outputSettings: settings, siteOwnedGraph: owned, baselineOutputRms: baseline.rms, rounds, overflow, pageErrors: errors });
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, scope: "V2 selected-stream Web Audio input and real browser playback output", browser: browser.version(),
    encodedVideoBytes: media.length, realSelectedVideoPCM: true, originalBrowserOutput: "measured via independent tab loopback",
    physicalSpeakerAudibility: "unverified", observations, timelineMapping: "unverified", asrAccuracy: "unverified",
    remainingAcceptance: ["V3 PCM timeline/epoch", "V4 media access matrix", "V5 speech/two-audible-video fixtures"] }));
  await verifyVideoTimeline(browser, `http://127.0.0.1:${server.address().port}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
