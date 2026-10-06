// Real tabCapture/local-model interruption and native restart, separate from quality acceptance.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { chromium } from "playwright";

const interruption = process.argv[2] ?? "stop";
assert.ok(["stop", "provider"].includes(interruption));
await mkdir(".ralph", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/interim-lifecycle-"));
const clips = [];
for (const [index, text] of [
  "The weather is sunny today.",
  "We should not cancel the trip because the rain will stop before noon. Bring a blue umbrella, and meet at the station at three in the afternoon.",
].entries()) {
  execFileSync("say", ["-v", "Samantha", "-r", "165", "-o", `${profile}/${index}.aiff`, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", `${profile}/${index}.aiff`, `${profile}/${index}.wav`]);
  clips.push(await readFile(`${profile}/${index}.wav`));
}
const fixture = createServer((request, response) => {
  const clip = clips[Number(request.url?.match(/^\/([01])\.wav$/)?.[1])];
  if (clip) { response.setHeader("Content-Type", "audio/wav"); response.end(clip); return; }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Interim lifecycle acceptance</title><style>body{background:#446879;color:white;font:24px system-ui}audio{width:80%}</style><h1>Generated English speech</h1><audio controls></audio></html>');
});
let context;
let companion;
let input;
let buffer = "";
let log = "";
const metrics = [];
const report = { interruption, measurement: `native ${interruption === "provider" ? "provider change" : "Stop"} during real local inference, then native Start; not latency or translation-quality acceptance`, checks: {} };
let oldSession;
let restartedSession;
let initialCaptionCount;
let clearedAtMs;
let failed = false;
try {
  await new Promise((ready) => fixture.listen(8766, "127.0.0.1", ready));
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: false, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  report.browser = context.browser().version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  companion = spawn("uv", ["run", "--locked", "--extra", "local", "uvicorn", "interim_browser_metrics:app", "--app-dir", "tests", "--host", "127.0.0.1", "--port", "8765", "--ws-max-size", "4096", "--ws-max-queue", "8"], {
    env: { ...process.env, PYTHONPATH: ".", INTERPRETER_EXTENSION_ID: extensionId, INTERPRETER_INTERIM_PHASE: "after", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  companion.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const metric = JSON.parse(line); if (metric.metric) metrics.push(metric); } catch { log += line; }
      end = buffer.indexOf("\n");
    }
  });
  companion.stderr.on("data", (chunk) => { log += chunk; });
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Companion startup timed out: ${log}`)), 20000);
    companion.once("error", reject);
    companion.stderr.on("data", () => { if (log.includes("Uvicorn running")) { clearTimeout(timeout); ready(); } });
  });
  const page = context.pages()[0];
  await page.goto("http://127.0.0.1:8766/");
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  assert.ok(tabId);
  await worker.evaluate(() => {
    globalThis.lifecycleStops = [];
    globalThis.lifecycleStarts = [];
    globalThis.lifecycleConfigurations = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.url === chrome.runtime.getURL("popup.html") && message.target === "worker" && message.type === "stop") globalThis.lifecycleStops.push(Date.now());
      if (sender.url === chrome.runtime.getURL("popup.html") && message.target === "worker" && message.type === "start") globalThis.lifecycleStarts.push(Date.now());
      if (sender.url === chrome.runtime.getURL("popup.html") && message.target === "worker" && message.type === "configure") globalThis.lifecycleConfigurations.push({ atMs: Date.now(), provider: message.settings.provider });
    });
  });
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    globalThis.lifecycleCaptions = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.id === chrome.runtime.id && message.target === "captions" && message.type === "caption") globalThis.lifecycleCaptions.push({ sessionId: message.caption.sessionId, atMs: Date.now() });
    });
  } }), tabId);
  console.log(JSON.stringify({ ready: true, profile, browser: report.browser,
    instructions: interruption === "provider"
      ? "Native toolbar Start. Open popup, then play → promptly select OpenAI Luna → stopped. Select Local · Ollama while idle, native Start → restarted → native Stop → stopped → exit. Do not Start a cloud provider."
      : "Native toolbar Start. Open popup with Stop visible, then play → click native Stop promptly → stopped. Native Start again → restarted → native Stop → stopped → exit." }));
  input = createInterface({ input: process.stdin });
  for await (const command of input) {
    try {
      if (command === "exit") break;
      if (command === "check") console.log(JSON.stringify(await worker.evaluate(() => chrome.storage.session.get("captureStatus"))));
      if (command === "play") {
        assert.ok(!oldSession && !restartedSession);
        const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
        assert.equal(captureStatus.state, "capturing");
        oldSession = captureStatus.sessionId;
        report.initialSession = oldSession;
        const starts = await worker.evaluate(() => globalThis.lifecycleStarts);
        assert.equal(starts.length, 1, "Use native popup Start exactly once");
        report.initialStartAtMs = starts[0];
        const captured = await worker.evaluate(() => chrome.tabCapture.getCapturedTabs());
        assert.ok(captured.some((tab) => tab.tabId === tabId && tab.status === "active"));
        report.capturedTabId = tabId;
        await page.locator("audio").evaluate(async (element) => { element.src = "/1.wav"; element.loop = true; await element.play(); });
        const deadline = Date.now() + 60000;
        while (!metrics.some((m) => m.sessionId === oldSession && m.metric === "translationStart")) {
          assert.ok(Date.now() < deadline, "No real translation started");
          await page.waitForTimeout(10);
        }
        console.log(JSON.stringify({ [interruption === "provider" ? "nativeProviderChangeNow" : "nativeStopNow"]: true, sessionId: oldSession, atMs: Date.now() }));
      }
      if (command === "stopped") {
        const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
        assert.equal(captureStatus.state, "idle");
        const captured = await worker.evaluate(() => chrome.tabCapture.getCapturedTabs());
        const offscreen = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }));
        assert.ok(!captured.some((tab) => tab.status === "active"));
        assert.equal(offscreen.length, 0);
        assert.equal(await page.locator("#interpreter-captions").count(), 0);
        const sessionId = restartedSession ?? oldSession;
        assert.ok(sessionId);
        const deadline = Date.now() + 30000;
        // Native MLX can finish after cancellation. Observe every started call ending.
        while (!metrics.some((m) => m.sessionId === sessionId && m.metric === "closed")
          || metrics.some((m) => m.sessionId === sessionId && m.metric === "asrStart"
            && !metrics.some((end) => end.sessionId === sessionId && end.metric === "asr" && end.startedAtMs === m.startedAtMs))) {
          assert.ok(Date.now() < deadline, "Inference/cleanup did not finish");
          await page.waitForTimeout(20);
        }
        const cleanup = metrics.find((m) => m.sessionId === sessionId && m.metric === "closed");
        assert.ok(cleanup.cancelled && !cleanup.readerActive && !cleanup.inferenceAwaited && !cleanup.translationActive);
        assert.equal(cleanup.pendingAudioMs, 0);
        assert.equal(cleanup.pendingTranslationMs, 0);
        const configuration = interruption === "provider" && !restartedSession
          ? (await worker.evaluate(() => globalThis.lifecycleConfigurations)).filter((change) => change.provider === "luna" && change.atMs > report.initialStartAtMs).at(-1)
          : undefined;
        const interruptedAtMs = configuration?.atMs ?? (await worker.evaluate(() => globalThis.lifecycleStops)).at(-1);
        assert.ok(interruptedAtMs, "Interruption must come from the actual popup control");
        if (interruption === "provider" && !restartedSession) {
          assert.ok(configuration, "Use the native provider selector, without pressing Stop");
          const settings = await worker.evaluate(() => chrome.storage.local.get("sessionSettings"));
          assert.equal(settings.sessionSettings.provider, "luna");
          assert.equal((await worker.evaluate(() => globalThis.lifecycleStarts)).length, 1, "Provider selection must not auto-start cloud capture");
          assert.equal((await worker.evaluate(() => globalThis.lifecycleStops)).length, 0, "Provider change must independently stop capture");
          report.checks.providerSelectedWhileIdle = true;
        }
        const overlap = metrics.filter((m) => m.sessionId === sessionId && ["asr", "translation"].includes(m.metric) && m.startedAtMs <= interruptedAtMs && interruptedAtMs <= m.atMs);
        const delivered = await worker.evaluate(async (id) => (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.lifecycleCaptions }))[0].result, tabId);
        const lateCaptions = metrics.filter((m) => m.sessionId === sessionId && m.metric === "caption" && m.atMs > cleanup.atMs).length;
        assert.equal(lateCaptions, 0);
        if (!restartedSession) {
          report[interruption === "provider" ? "initialProviderChange" : "initialStop"] = { interruptedAtMs, overlap, cleanup, captionHosts: 0, offscreenContexts: 0, activeCapturedTabs: 0, lateCaptions };
          assert.ok(overlap.length, "Native interruption did not overlap inference; rerun instead of claiming in-flight evidence");
          const receipt = metrics.filter((m) => m.sessionId === oldSession && m.metric === "receipt" && m.peak > 0).at(-1);
          assert.ok(receipt, "No non-silent captured PCM receipt");
          report.nonSilentReceipt = receipt;
          report.mediaAfterStop = await page.locator("audio").evaluate((element) => ({ currentTime: element.currentTime, duration: element.duration, paused: element.paused }));
          assert.ok(report.mediaAfterStop.currentTime > 0 && !report.mediaAfterStop.paused);
          clearedAtMs = Date.now();
          initialCaptionCount = delivered.filter((c) => c.sessionId === oldSession).length;
          report.initialDelivered = delivered;
          await page.locator("audio").evaluate((element) => { element.pause(); element.loop = false; });
          report.checks[interruption === "provider" ? "inflightProviderChange" : "inflightStop"] = true;
          report.checks.cleanup = true;
          report.checks.realTabPcm = true;
        } else {
          assert.ok(report.checks.restarted);
          assert.ok(interruptedAtMs > (report.initialProviderChange ?? report.initialStop).interruptedAtMs);
          report.finalCleanup = { stopAtMs: interruptedAtMs, cleanup, captionHosts: 0, offscreenContexts: 0, activeCapturedTabs: 0, lateCaptions };
          report.checks.finalStop = true;
        }
        console.log(JSON.stringify({ stopped: true, overlap: overlap.map((m) => m.metric), checks: report.checks }));
      }
      if (command === "restarted") {
        assert.ok(report.checks[interruption === "provider" ? "inflightProviderChange" : "inflightStop"] && !restartedSession);
        const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
        assert.equal(captureStatus.state, "capturing");
        restartedSession = captureStatus.sessionId;
        assert.notEqual(restartedSession, oldSession);
        const starts = await worker.evaluate(() => globalThis.lifecycleStarts);
        assert.equal(starts.length, 2, "Restart must use the actual popup Start button");
        assert.ok(starts[1] > (report.initialProviderChange ?? report.initialStop).interruptedAtMs);
        if (interruption === "provider") {
          const configurations = await worker.evaluate(() => globalThis.lifecycleConfigurations);
          const restored = configurations.find((change) => change.provider === "local" && change.atMs > report.initialProviderChange.interruptedAtMs);
          assert.ok(restored && restored.atMs <= starts[1], "Restore Local · Ollama through the native popup before Start");
          const preparations = metrics.filter((m) => m.metric === "prepare");
          assert.ok(preparations.every((m) => [oldSession, restartedSession].includes(m.sessionId) && m.textModel === "qwen3.5:9b"), "Provider selection must not prepare a cloud session");
          report.localRestoredAtMs = restored.atMs;
          report.checks.noCloudSession = true;
        }
        report.restartStartAtMs = starts[1];
        await page.locator("audio").evaluate(async (element) => { element.src = "/0.wav"; element.loop = false; await element.play(); });
        const deadline = Date.now() + 60000;
        while (!metrics.some((m) => m.sessionId === restartedSession && m.metric === "caption" && m.final)) {
          assert.ok(Date.now() < deadline, "Restart never produced an actual final caption");
          await page.waitForTimeout(20);
        }
        await page.waitForFunction(() => document.querySelector("#interpreter-captions")?.shadowRoot?.textContent?.match(/[가-힣]/), undefined, { timeout: 10000 });
        const delivered = await worker.evaluate(async (id) => (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.lifecycleCaptions }))[0].result, tabId);
        assert.equal(delivered.filter((c) => c.sessionId === oldSession).length, initialCaptionCount);
        assert.ok(delivered.some((c) => c.sessionId === restartedSession));
        assert.ok(!metrics.some((m) => m.sessionId === oldSession && m.metric === "caption" && m.atMs > clearedAtMs));
        report.restartedSession = restartedSession;
        report.restartedDelivered = delivered;
        report.clearedAtMs = clearedAtMs;
        report.checks.restarted = true;
        report.checks.noLateOldCaptions = true;
        console.log(JSON.stringify({ restarted: true, sessionId: restartedSession, checks: report.checks }));
      }
    } catch (error) {
      failed = true;
      report.error = String(error);
      console.log(JSON.stringify({ error: report.error }));
    }
  }
} finally {
  input?.close(); process.stdin.pause();
  await context?.close();
  if (companion?.pid && companion.exitCode === null) {
    const exited = once(companion, "exit"); companion.kill("SIGINT"); await exited;
  }
  await new Promise((closed) => fixture.close(closed));
  report.metrics = metrics;
  const required = [interruption === "provider" ? "inflightProviderChange" : "inflightStop", "cleanup", "realTabPcm", "restarted", "noLateOldCaptions", "finalStop"];
  if (interruption === "provider") required.push("providerSelectedWhileIdle", "noCloudSession");
  report.acceptancePassed = !failed && required.every((key) => report.checks[key]);
  await writeFile(`.ralph/interim-lifecycle${interruption === "provider" ? "-provider" : ""}${report.acceptancePassed ? "" : "-failed"}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ acceptancePassed: report.acceptancePassed, checks: report.checks }));
  if (!report.acceptancePassed) process.exitCode = 1;
}
