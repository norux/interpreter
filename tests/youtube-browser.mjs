// Real YouTube/tabCapture/local-model acceptance. Start/Stop use the native toolbar.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { chromium } from "playwright";

await mkdir(".ralph", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/youtube-browser-"));
const url = process.argv[2] ?? "https://www.youtube.com/watch?v=iG9CE55wbtY";
assert.equal(new URL(url).origin, "https://www.youtube.com");
const metrics = [];
const paints = [];
const memory = [];
const shots = new Set();
const checks = new Set();
const mediaErrors = [];
let context;
let companion;
let input;
let sampling;
let page;
let worker;
let longSession;
let mediaSeconds = 0;
let previousMedia;
let previousSession;
let lineBuffer = "";
let log = "";
let failed = false;
let playbackError;

async function startCompanion() {
  const extensionId = new URL(worker.url()).host;
  const child = spawn("uv", ["run", "--locked", "--extra", "local", "uvicorn", "browser_metrics:app",
    "--app-dir", "tests", "--host", "127.0.0.1", "--port", "8765", "--ws-max-size", "4096", "--ws-max-queue", "8"], {
    env: { ...process.env, PYTHONPATH: ".", INTERPRETER_EXTENSION_ID: extensionId,
      INTERPRETER_PROVIDER: "local", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    lineBuffer += chunk;
    let end = lineBuffer.indexOf("\n");
    while (end >= 0) {
      const line = lineBuffer.slice(0, end); lineBuffer = lineBuffer.slice(end + 1);
      try { const metric = JSON.parse(line); if (metric.metric) metrics.push(metric); } catch {}
      end = lineBuffer.indexOf("\n");
    }
  });
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Companion startup timed out: ${log}`)), 30000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.stderr.on("data", (chunk) => {
      log += chunk;
      if (String(chunk).includes("Uvicorn running")) { clearTimeout(timeout); ready(); }
    });
  });
  return child;
}
async function stopCompanion() {
  if (companion?.pid && companion.exitCode === null) {
    const exited = once(companion, "exit"); companion.kill("SIGINT"); await exited;
  }
}
async function state() {
  const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
  const captured = await worker.evaluate(() => chrome.tabCapture.getCapturedTabs());
  const offscreen = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }));
  const media = await page.locator("video").evaluate((video) => ({ time: video.currentTime, duration: video.duration,
    paused: video.paused, muted: video.muted, rate: video.playbackRate,
    error: video.error ? { code: video.error.code, message: video.error.message } : null })).catch(() => null);
  return { captureStatus, captured, offscreen: offscreen.length, media,
    hosts: await page.locator("#interpreter-captions").count() };
}
async function cleanupCheck(expected) {
  const result = await state();
  assert.equal(result.captureStatus.state, expected);
  assert.equal(result.captured.some((tab) => tab.status === "active"), false);
  assert.equal(result.offscreen, 0);
  assert.equal(result.hosts, 0);
  return result;
}
function summary() {
  const receipts = metrics.filter((m) => m.metric === "receipt" && m.sessionId === longSession);
  const captions = metrics.filter((m) => m.metric === "caption" && m.sessionId === longSession);
  const latencies = paints.filter((p) => p.sessionId === longSession).map((p) => p.latencyMs).sort((a, b) => a - b);
  const percentile = (values, p) => values.length ? values[Math.ceil(values.length * p) - 1] : null;
  const peak = (field) => Math.max(0, ...metrics.map((m) => m[field] ?? 0));
  return { browser: context.browser().version(), video: url,
    realTabCapture: receipts.length > 0, realLocalModels: captions.some((m) => m.asrMs > 0),
    mediaSeconds, captions: captions.length, paintedCaptions: latencies.length,
    latencyP50Ms: percentile(latencies, .5), latencyP95Ms: percentile(latencies, .95),
    maxPendingAudioMs: Math.max(0, ...receipts.map((r) => r.pendingAudioMs)),
    droppedFrames: receipts.at(-1)?.droppedFrames ?? null,
    droppedUtterances: receipts.at(-1)?.droppedUtterances ?? null,
    mlxActivePeakBytes: peak("mlxActiveBytes"), mlxPeakBytes: peak("mlxPeakBytes"),
    memory, mediaErrors, playbackError, checks: [...checks], screenshots: [...shots] };
}
try {
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: false, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "caption") globalThis.lastLocalCaption = message.caption;
    });
  });
  companion = await startCompanion();
  page = context.pages()[0];
  page.on("response", (response) => {
    const host = new URL(response.url()).hostname;
    if (host.endsWith(".googlevideo.com") && response.status() >= 400) {
      mediaErrors.push({ status: response.status(), atMs: Date.now() });
    }
  });
  await page.exposeBinding("captionPainted", (_source, atMs) => {
    const caption = metrics.findLast((m) => m.metric === "caption" && m.atMs <= atMs);
    if (caption && !paints.some((p) => p.sessionId === caption.sessionId && p.utteranceId === caption.utteranceId)) {
      paints.push({ sessionId: caption.sessionId, utteranceId: caption.utteranceId,
        latencyMs: atMs - caption.originMs - caption.audioEndMs });
    }
  });
  await page.addInitScript(() => {
    let previous = "";
    const observe = () => {
      const text = document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".cue")?.textContent ?? "";
      if (text && text !== previous) void window.captionPainted(Date.now());
      previous = text;
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  await page.goto(url);
  await page.locator("video").waitFor();
  console.log(JSON.stringify({ ready: true, browser: context.browser().version(), url,
    instructions: "Native toolbar → Interpreter → Start; close popup; native Play. Commands: check, long, shot normal/theatre/fullscreen, stopped, navigation, disconnect, restart, recovered, report, blocked, accept, exit." }));
  let samplingBusy = false;
  let ticks = 0;
  sampling = setInterval(async () => {
    if (samplingBusy) return;
    samplingBusy = true;
    try {
      const result = await state();
      const session = result.captureStatus?.sessionId;
      if (session === longSession && previousSession === session && result.media && !result.media.paused && !result.media.muted && result.media.rate === 1) {
        const delta = result.media.time - previousMedia;
        if (delta > 0 && delta < 2) mediaSeconds += delta;
      }
      previousMedia = result.media?.time;
      previousSession = session;
      if (++ticks % 30 === 0) {
        const processes = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,comm="], { encoding: "utf8" });
        // Dedicated test profile and the two model processes; exclude other apps.
        const rows = processes.trim().split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
        const commandLines = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
        const browserIds = new Set(commandLines.split("\n").filter((line) => line.includes(profile)).map((line) => Number(line.trim().split(/\s+/)[0])));
        for (const row of rows) if (browserIds.has(Number(row[2]))) browserIds.add(Number(row[1]));
        const rss = (predicate) => rows.filter(predicate).reduce((total, row) => total + Number(row[3]) * 1024, 0);
        const models = await fetch("http://127.0.0.1:11434/api/ps").then((r) => r.json());
        if (session === longSession && longSession) memory.push({ elapsedSeconds: ticks, mediaSeconds,
          companionRssBytes: rss((r) => Number(r[2]) === companion.pid),
          ollamaRssBytes: rss((r) => r[4].includes("ollama")),
          browserRssBytes: rss((r) => browserIds.has(Number(r[1]))),
          ollamaAllocatedBytes: models.models?.[0]?.size_vram ?? 0 });
        console.log(JSON.stringify({ progress: true, mediaSeconds, status: result.captureStatus?.state,
          pendingAudioMs: metrics.findLast((m) => m.metric === "receipt")?.pendingAudioMs }));
      }
    } catch (error) { console.log(JSON.stringify({ samplingError: String(error) })); }
    finally { samplingBusy = false; }
  }, 1000);
  input = createInterface({ input: process.stdin });
  for await (const command of input) {
    try {
      if (command === "exit") break;
      if (command === "check") console.log(JSON.stringify({ ...(await state()),
        cue: await page.locator("#interpreter-captions .cue").textContent({ timeout: 1000 }).catch(() => ""),
        lastCaption: await worker.evaluate(() => globalThis.lastLocalCaption),
        recent: metrics.slice(-2) }));
      if (command === "long") {
        const result = await state();
        assert.equal(result.captureStatus.state, "capturing");
        assert.equal(result.captured.some((t) => t.status === "active"), true);
        assert.equal(result.media.rate, 1); assert.equal(result.media.muted, false);
        longSession = result.captureStatus.sessionId; mediaSeconds = 0; memory.length = 0;
        console.log("Ten-minute media observation started.");
      }
      if (command.startsWith("shot ")) {
        const name = command.slice(5);
        assert.ok(["normal", "theatre", "fullscreen"].includes(name));
        const cue = page.locator("#interpreter-captions .cue");
        await cue.waitFor({ timeout: 90000 });
        const layout = await cue.evaluate((element) => {
          const style = getComputedStyle(element); const box = element.getBoundingClientRect();
          return { text: element.textContent, height: element.clientHeight, lineHeight: Number.parseFloat(style.lineHeight),
            pointerEvents: getComputedStyle(element.getRootNode().host).pointerEvents,
            bottom: box.bottom, controlTop: document.querySelector(".ytp-chrome-bottom").getBoundingClientRect().top,
            fullscreen: !!document.fullscreenElement, insideFullscreen: document.fullscreenElement?.contains(element.getRootNode().host) ?? false,
            theatre: document.querySelector("ytd-watch-flexy").hasAttribute("theater") };
        });
        assert.match(layout.text, /[가-힣]/); assert.ok(layout.height <= layout.lineHeight * 2 + 9);
        assert.equal(layout.pointerEvents, "none"); assert.ok(layout.bottom < layout.controlTop - 10);
        assert.equal(layout.fullscreen, name === "fullscreen");
        if (name === "fullscreen") assert.equal(layout.insideFullscreen, true);
        if (name === "theatre") assert.equal(layout.theatre, true);
        await mkdir("docs/verification/youtube", { recursive: true });
        await page.screenshot({ path: `docs/verification/youtube/${name}.png` });
        shots.add(name); console.log(JSON.stringify({ screenshot: name, layout }));
      }
      if (command === "stopped") { console.log(JSON.stringify(await cleanupCheck("idle"))); checks.add("stop"); }
      if (command === "navigation") { console.log(JSON.stringify(await cleanupCheck("idle"))); checks.add("navigation"); }
      if (command === "disconnect") {
        assert.equal((await state()).captureStatus.state, "capturing");
        await stopCompanion();
        await new Promise((ready) => setTimeout(ready, 1500));
        console.log(JSON.stringify(await cleanupCheck("error"))); checks.add("disconnect");
      }
      if (command === "restart") { companion = await startCompanion(); console.log("Companion restarted; use native Start."); }
      if (command === "recovered") {
        const result = await state(); assert.equal(result.captureStatus.state, "capturing");
        assert.notEqual(result.captureStatus.sessionId, longSession);
        await page.locator("#interpreter-captions .cue").waitFor({ timeout: 90000 });
        assert.match(await page.locator("#interpreter-captions .cue").textContent(), /[가-힣]/);
        checks.add("recovery"); console.log(JSON.stringify({ recovered: true, ...result }));
      }
      if (command === "report" || command === "accept") {
        const report = summary(); console.log(JSON.stringify(report));
        await writeFile(`${profile}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
        if (command === "accept") {
          assert.ok(mediaSeconds >= 600, "At least 600 seconds of advancing, unmuted 1× media required");
          assert.ok(report.paintedCaptions >= 20); assert.ok(report.latencyP50Ms >= 0);
          assert.ok(report.maxPendingAudioMs <= 8000); assert.notEqual(report.droppedFrames, null);
          assert.ok(memory.length >= 20 && memory.some((m) => m.companionRssBytes > 0 && m.ollamaRssBytes > 0 && m.browserRssBytes > 0));
          for (const check of ["stop", "navigation", "disconnect", "recovery"]) assert.ok(checks.has(check), check);
          for (const shot of ["normal", "theatre", "fullscreen"]) assert.ok(shots.has(shot), shot);
          await cleanupCheck("idle");
          await writeFile("docs/verification/youtube/metrics.json", `${JSON.stringify(report, null, 2)}\n`);
          checks.add("accepted");
        }
      }
      if (command === "blocked") {
        const result = await state();
        playbackError = { media: result.media,
          playerMessage: await page.locator(".ytp-error").innerText({ timeout: 1000 }).catch(() => "") };
        assert.ok(playbackError.media?.error || playbackError.playerMessage);
        await mkdir("docs/verification/youtube", { recursive: true });
        await page.screenshot({ path: "docs/verification/youtube/playback-error.png" });
        await writeFile("docs/verification/youtube/blocked.json", `${JSON.stringify({ accepted: false, ...summary() }, null, 2)}\n`);
        console.log(JSON.stringify({ blocked: true, playbackError }));
      }
    } catch (error) { failed = true; console.log(JSON.stringify({ error: String(error) })); }
  }
} finally {
  clearInterval(sampling); input?.close(); process.stdin.pause();
  await context?.close(); await stopCompanion();
  if (failed || !checks.has("accepted")) process.exitCode = 1;
}
