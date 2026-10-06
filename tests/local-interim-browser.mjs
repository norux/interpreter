// Actual tabCapture + unchanged local models. Start/Stop through the native toolbar.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { chromium } from "playwright";
import { traceCaptionPaints } from "./caption-paint.mjs";

const phase = process.argv[2];
assert.ok(["before", "after"].includes(phase));
const trial = process.argv[3];
assert.ok([undefined, "interval500", "interval1000", "first500", "first300"].includes(trial));
assert.ok(!trial || phase === "after");
await mkdir(".ralph", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/interim-browser-"));
const clips = [];
const bounds = [];
for (const [index, text] of ["The weather is sunny today.", "I saw a crane lifting steel beams at the construction site.",
  "We should not cancel the trip because the rain will stop before noon. Bring a blue umbrella, and meet at the station at three in the afternoon."].entries()) {
  execFileSync("say", ["-v", "Samantha", "-r", "165", "-o", `${profile}/${index}.aiff`, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", `${profile}/${index}.aiff`, `${profile}/${index}.wav`]);
  const wav = await readFile(`${profile}/${index}.wav`);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunk = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= wav.length);
    if (chunk === "fmt ") {
      assert.equal(wav.readUInt16LE(offset + 8), 1);
      assert.equal(wav.readUInt16LE(offset + 10), 1);
      assert.equal(wav.readUInt32LE(offset + 12), 24000);
      assert.equal(wav.readUInt16LE(offset + 22), 16);
    }
    if (chunk === "data") pcm = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  assert.ok(pcm && pcm.length % 2 === 0);
  const voiced = [];
  for (let offset = 0; offset < pcm.length; offset += 2) if (Math.abs(pcm.readInt16LE(offset)) >= 100) voiced.push(offset / 2);
  assert.ok(voiced.length);
  bounds.push({ voiceStartMs: voiced[0] / 24, voiceEndMs: voiced.at(-1) / 24 });
  clips.push(wav);
}
const fixture = createServer((request, response) => {
  const clip = clips[Number(request.url?.match(/^\/([012])\.wav$/)?.[1])];
  if (clip) { response.setHeader("Content-Type", "audio/wav"); response.end(clip); return; }
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Interim subtitle acceptance</title>
    <style>body{margin:0;background:#446879;color:white;font:24px system-ui}main{padding:48px}audio{width:80%}#scene:fullscreen{background:#446879}#control{position:fixed;bottom:24px;left:40%;height:36px}</style>
    <main id="scene"><h1>Generated English speech</h1><p>Snapshot comparison: ${phase}</p><audio controls></audio><button id="fullscreen">Fullscreen</button><button id="control">Caption-area control</button></main>
    <script>fullscreen.onclick=()=>scene.requestFullscreen();control.onclick=()=>control.dataset.clicks=String(Number(control.dataset.clicks||0)+1);</script></html>`);
});
let context;
let companion;
let input;
let finishTrace;
let failed = false;
let measured = false;
let stopped = false;
const metrics = [];
const samples = [];
let buffer = "";
let log = "";
try {
  await new Promise((ready) => fixture.listen(8766, "127.0.0.1", ready));
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: false, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const unloaded = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen3.5:9b", keep_alive: 0 }),
  });
  assert.ok(unloaded.ok);
  companion = spawn("uv", ["run", "--locked", "--extra", "local", "uvicorn", "interim_browser_metrics:app", "--app-dir", "tests",
    "--host", "127.0.0.1", "--port", "8765", "--ws-max-size", "4096", "--ws-max-queue", "8"], {
    env: { ...process.env, PYTHONPATH: ".", INTERPRETER_EXTENSION_ID: extensionId,
      INTERPRETER_INTERIM_PHASE: phase, ...(trial ? { INTERPRETER_INTERIM_TRIAL: trial } : {}),
      HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
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
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), tabId);
  await worker.evaluate(() => {
    globalThis.interimNativeStarts = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.url === chrome.runtime.getURL("popup.html") && message.target === "worker" && message.type === "start") globalThis.interimNativeStarts.push(Date.now());
    });
  });
  finishTrace = await traceCaptionPaints(context, page, worker, tabId);
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    globalThis.interimCaptions = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.id === chrome.runtime.id && message.target === "captions" && message.type === "caption") globalThis.interimCaptions.push(message.caption);
    });
  } }), tabId);
  console.log(JSON.stringify({ ready: true, browser: context.browser().version(), phase, profile,
    instructions: "Native Extensions toolbar → Interpreter → Start; close popup. measure (isolated short clips) OR continuous (nine clips without inference/expiry waits) OR appearance (after, default only) → native Stop → stopped → exit. Failed reports still require Stop cleanup." }));
  input = createInterface({ input: process.stdin });
  for await (const command of input) {
    try {
      if (command === "exit") break;
      if (command === "check") console.log(JSON.stringify(await worker.evaluate(() => chrome.storage.session.get("captureStatus"))));
      if (command === "appearance") {
        assert.equal(phase, "after");
        assert.equal(trial, undefined, "Appearance verifies the unchanged product schedule");
        assert.ok(!measured && finishTrace);
        const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
        assert.equal(captureStatus?.state, "capturing", "Appearance requires actual native Start before measurement");
        assert.equal((await worker.evaluate(() => globalThis.interimNativeStarts)).length, 1);
        assert.ok((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some((tab) => tab.tabId === tabId && tab.status === "active"));
        const appearances = [];
        for (const mode of ["normal", "narrow", "fullscreen"]) {
          await page.setViewportSize(mode === "narrow" ? { width: 270, height: 700 } : { width: 1280, height: 800 });
          if (mode === "fullscreen") {
            await page.locator("#fullscreen").click();
            await page.waitForFunction(() => !!document.fullscreenElement);
          }
          await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
            globalThis.appearanceViews = [];
            const identities = new WeakMap();
            let identity = 0;
            let shadow;
            const record = () => {
              const host = document.querySelector("#interpreter-captions");
              const root = host?.shadowRoot;
              if (root && root !== shadow) { shadow = root; observer.observe(root, { childList: true, subtree: true, characterData: true }); }
              const cue = root?.querySelector(".cue");
              const box = cue?.getBoundingClientRect();
              const css = cue && getComputedStyle(cue);
              globalThis.appearanceViews.push({ atMs: performance.timeOrigin + performance.now(),
                width: innerWidth, height: innerHeight, fullscreen: !!document.fullscreenElement,
                fullscreenAttached: !!document.fullscreenElement?.contains(host),
                hostCount: document.querySelectorAll("#interpreter-captions").length,
                lineHeight: css ? Number.parseFloat(css.lineHeight) : 0,
                surfaceHeight: box?.height ?? 0, left: box?.left ?? 0, right: box?.right ?? 0,
                top: box?.top ?? 0, bottom: box?.bottom ?? 0, pointerEvents: css?.pointerEvents,
                notice: root?.querySelector(".notice")?.textContent ?? "",
                sentences: [...(root?.querySelectorAll(".sentence") ?? [])].map((node) => {
                  if (!identities.has(node)) identities.set(node, ++identity);
                  const caption = globalThis.interimCaptions.filter((c) => c.utteranceId === node.dataset.utteranceId).at(-1);
                  return { id: node.dataset.utteranceId, nodeId: identities.get(node), text: node.textContent,
                    revision: caption?.revision, final: caption?.final, height: node.getBoundingClientRect().height };
                }) });
            };
            const observer = new MutationObserver(record);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            globalThis.appearanceObserver = observer;
            record();
          } }), tabId);
          const start = metrics.length;
          const media = await page.locator("audio").evaluate(async (element) => {
            element.src = "/2.wav"; await element.play();
            return { startedAtMs: performance.timeOrigin + performance.now(), durationMs: element.duration * 1000 };
          });
          const observed = () => metrics.slice(start).filter((m) => m.sessionId === captureStatus.sessionId);
          const deadline = Date.now() + 90000;
          while (!observed().some((m) => m.metric === "caption" && m.final)) {
            assert.ok(Date.now() < deadline, "No actual final for appearance");
            await page.waitForTimeout(20);
          }
          await page.waitForFunction(() => !!document.querySelector("#interpreter-captions")?.shadowRoot?.querySelector(".sentence"));
          await page.screenshot({ path: `${profile}/appearance-${mode}.png` });
          await page.locator("#control").click();
          const controlsClicked = Number(await page.locator("#control").getAttribute("data-clicks"));
          // Finish all real audio/inference and every displayed part, without injecting captions.
          await page.waitForFunction(() => document.querySelector("audio").ended);
          let drain = 0;
          while (drain < 10) {
            const receipt = observed().filter((m) => m.metric === "receipt").at(-1);
            const running = observed().some((m) => ["asrStart", "translationStart"].includes(m.metric)
              && !observed().some((end) => end.metric === m.metric.replace("Start", "") && end.startedAtMs === m.startedAtMs));
            assert.ok(Date.now() < deadline, "Appearance inference did not drain");
            drain = receipt && !running && receipt.pendingAudioMs === 0 && receipt.pendingTranslationMs === 0 ? drain + 1 : 0;
            await page.waitForTimeout(100);
          }
          await page.waitForFunction(() => !document.querySelector("#interpreter-captions"), undefined, { timeout: 45000 });
          const raw = await worker.evaluate(async (id) => (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
            globalThis.appearanceObserver.disconnect();
            return { views: globalThis.appearanceViews, captions: globalThis.interimCaptions };
          } }))[0].result, tabId);
          const finals = observed().filter((m) => m.metric === "caption" && m.final);
          const parts = finals.map((final) => {
            const full = raw.captions.find((c) => c.utteranceId === final.utteranceId && c.revision === final.revision).translation.trim();
            const views = raw.views.filter((v) => v.sentences.some((s) => s.id === final.utteranceId));
            const finalViews = raw.views.filter((v) => v.atMs >= final.atMs);
            const changes = [];
            for (const view of finalViews) {
              const sentence = view.sentences.find((s) => s.id === final.utteranceId);
              if (sentence?.final && sentence.text !== changes.at(-1)?.text) changes.push({ ...sentence, atMs: view.atMs });
            }
            const covered = new Set();
            for (const view of views) {
              const text = view.sentences.find((s) => s.id === final.utteranceId).text;
              const offset = full.indexOf(text);
              if (offset >= 0) for (let i = offset; i < offset + text.length; i++) covered.add(i);
            }
            for (const part of changes) {
              const end = finalViews.find((v) => v.atMs > part.atMs && v.sentences.find((s) => s.id === part.id)?.text !== part.text);
              part.untilMs = end?.atMs ?? null;
              part.requiredReadingMs = Math.min(6000, Math.max(2500, part.text.length * 90));
            }
            return { utteranceId: final.utteranceId, finalRevision: final.revision, finalCharacters: full.length,
              coveredFinalCharacters: covered.size, nodeIds: [...new Set(views.flatMap((v) => v.sentences.filter((s) => s.id === final.utteranceId).map((s) => s.nodeId)))],
              finalParts: changes.map(({ text, ...part }) => ({ ...part, characters: text.length })),
              fullFinalCovered: covered.size === full.length,
              finalReadingTime: changes.length > 0 && changes.every((p) => p.untilMs !== null && p.untilMs - p.atMs >= p.requiredReadingMs - 100) };
          });
          const visible = raw.views.filter((v) => v.sentences.length);
          const receipt = observed().filter((m) => m.metric === "receipt").at(-1);
          const checks = { actualFinals: finals.length > 0, fullFinalCovered: parts.every((p) => p.fullFinalCovered),
            finalReadingTime: parts.every((p) => p.finalReadingTime), inPlaceRevisions: parts.every((p) => p.nodeIds.length === 1),
            geometry: visible.length > 0 && visible.every((v) => v.hostCount === 1 && v.left >= 0 && v.right <= v.width + 1 && v.top >= 0 && v.bottom <= v.height && v.surfaceHeight <= v.lineHeight * 4 + 9 && v.sentences.every((s) => s.height <= v.lineHeight * 2 + 1)),
            fullscreen: mode !== "fullscreen" || visible.every((v) => v.fullscreen && v.fullscreenAttached),
            controls: controlsClicked === appearances.length + 1 && visible.every((v) => v.pointerEvents === "none"),
            noDisplayDrops: visible.every((v) => !v.notice), noInferenceDrops: receipt?.droppedFrames === 0 && receipt.droppedUtterances === 0 && receipt.droppedTranslations === 0 };
          appearances.push({ mode, media, checks, parts, observations: raw.views.map((v) => ({ ...v, notice: !!v.notice,
            sentences: v.sentences.map(({ text, ...s }) => ({ ...s, characters: text.length })) })),
            captionRevisions: observed().filter((m) => m.metric === "caption"), receipt });
          await writeFile(`${profile}/appearance-${mode}-raw.json`, `${JSON.stringify(raw, null, 2)}\n`);
          console.log(JSON.stringify({ appearance: mode, checks, screenshot: `${profile}/appearance-${mode}.png` }));
          if (mode === "fullscreen") { await page.evaluate(() => document.exitFullscreen()); await page.waitForFunction(() => !document.fullscreenElement); }
        }
        const rows = await finishTrace(); finishTrace = undefined;
        const preparation = metrics.find((m) => m.metric === "prepare");
        const report = { browser: context.browser().version(), realTabCapture: true, realLocalModels: true,
          measurement: "Mutation-observed DOM appearance and final reading intervals; covering caption Paint recorded separately, not acoustic timing",
          limitations: "Three isolated long clips with drain/expiry waits; no throughput, latency comparison, meaning, listening or physical-screen flicker acceptance",
          modelSettings: preparation, wavSha256: createHash("sha256").update(clips[2]).digest("hex"), appearances, paints: rows,
          automatedChecksPassed: appearances.every((a) => Object.values(a.checks).every(Boolean)),
          visualReview: "pending; review the three owned-profile screenshots", appearanceAcceptancePassed: false, full7dAcceptancePassed: false };
        await writeFile(`.ralph/interim-appearance${report.automatedChecksPassed ? "" : "-failed"}.json`, `${JSON.stringify(report, null, 2)}\n`);
        measured = true;
        assert.ok(report.automatedChecksPassed, "Actual caption appearance checks failed; numeric evidence preserved");
      }
      if (command === "measure") {
        assert.ok(!["first500", "first300"].includes(trial), "Use continuous for the direct first-snapshot comparison");
        assert.ok(finishTrace && !measured);
        const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
        assert.equal(captureStatus.state, "capturing");
        for (let repetition = -1; repetition < 3; repetition++) {
          for (let clip = 0; clip < (repetition < 0 ? 1 : 2); clip++) {
            const start = metrics.length;
            const mediaOriginMs = await page.locator("audio").evaluate(async (element, index) => {
              element.src = `/${index}.wav`;
              const playing = new Promise((ready) => element.addEventListener("playing", () => ready(performance.timeOrigin + performance.now() - element.currentTime * 1000), { once: true }));
              await element.play(); return playing;
            }, clip);
            const trial = () => metrics.slice(start).filter((m) => m.sessionId === captureStatus.sessionId);
            const deadline = Date.now() + 90000;
            while (!trial().some((m) => m.metric === "caption" && m.final)) {
              assert.ok(Date.now() < deadline, "No actual final caption");
              await page.waitForTimeout(20);
            }
            await page.waitForTimeout(100);
            const captions = trial().filter((m) => m.metric === "caption");
            assert.equal(new Set(captions.map((m) => m.utteranceId)).size, 1);
            assert.equal(captions.filter((m) => m.final).length, 1);
            assert.deepEqual(captions.map((m) => m.revision), [...new Set(captions.map((m) => m.revision))].sort((a, b) => a - b));
            const final = captions.at(-1);
            const review = await worker.evaluate(async ({ tabId, utteranceId }) => {
              const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId },
                func: (id) => globalThis.interimCaptions.filter((c) => c.utteranceId === id),
                args: [utteranceId],
              });
              return result;
            }, { tabId, utteranceId: final.utteranceId });
            const translated = review.at(-1).translation;
            console.log(JSON.stringify({ review: [repetition, clip], source: review.at(-1).source, translation: translated,
              corrections: review.map((c) => [c.source, c.translation, c.final]) }));
            const checks = { korean: /[가-힣]/.test(translated),
              ...(clip === 0 ? { todayMeaning: /오늘/.test(translated), sunnyMeaning: /맑|화창/.test(translated) }
                : { craneMeaning: /크레인/.test(translated), steelMeaning: /철|강철/.test(translated) }) };
            samples.push({ repetition, clip, sessionId: final.sessionId, utteranceId: final.utteranceId, finalRevision: final.revision,
              mediaOriginMs, ...bounds[clip], checks,
              sourceCorrections: review.filter((c, i) => i > 0 && c.source !== review[i - 1].source).length,
              translationUpdates: review.filter((c, i) => i > 0 && c.translation !== review[i - 1].translation).length,
              asrCalls: trial().filter((m) => m.metric === "asr"), translationCalls: trial().filter((m) => m.metric === "translation"),
              memorySamples: trial().filter((m) => m.metric === "sample"), captions });
            await page.waitForFunction(() => !document.querySelector("#interpreter-captions"), undefined, { timeout: 30000 });
          }
        }
        const rows = await finishTrace(); finishTrace = undefined;
        for (const sample of samples) {
          const revisions = rows.filter((r) => r.type === "caption" && r.sessionId === sample.sessionId && r.utteranceId === sample.utteranceId);
          const first = revisions.find((r) => r.paintAtMs !== null);
          const final = revisions.find((r) => r.final && r.revision === sample.finalRevision);
          sample.firstPaintFromVoiceStartMs = first ? first.paintAtMs - sample.mediaOriginMs - sample.voiceStartMs : null;
          sample.finalPaintFromVoiceEndMs = final?.paintAtMs != null ? final.paintAtMs - sample.mediaOriginMs - sample.voiceEndMs : null;
          sample.duringSpeechPaints = revisions.filter((r) => !r.final && r.paintAtMs !== null && r.paintAtMs < sample.mediaOriginMs + sample.voiceEndMs).length;
          sample.revisions = revisions.map((r) => {
            const caption = sample.captions.find((c) => c.revision === r.revision);
            assert.ok(caption && Number.isFinite(caption.originMs));
            return { ...r, audioPositionToPaintMs: r.paintAtMs !== null ? r.paintAtMs - caption.originMs - r.audioEndMs : null };
          });
          Object.assign(sample.checks, { firstPaint: !!first, finalPaint: final?.paintAtMs != null,
            memorySampled: sample.memorySamples.length > 0,
            ...(phase === "after" ? { duringSpeech: sample.duringSpeechPaints > 0,
              ...(sample.clip === 1 ? { sourceCorrection: sample.sourceCorrections > 0 } : {}) } : {}) });
        }
        const receipts = metrics.filter((m) => m.metric === "receipt");
        const queueSamples = metrics.filter((m) => ["sample", "receipt"].includes(m.metric));
        const report = { phase, browser: context.browser().version(), realTabCapture: true, realLocalModels: true,
          measurement: "covering Chromium main-frame Paint; PCM abs>=100 bounds aligned to observed audio playing/currentTime; not acoustic timing",
          audioPositionOrigin: "first PCM receive minus frame timestamp and 20ms; estimate includes local transport delay",
          baseline: "before disables only cumulative snapshots; identical VAD300ms/quality boundary/6sec cap, models, prompt, preparation and token streaming",
          coldComparison: "cached weights and OS caches; fresh engine, selected Ollama model unloaded, separate first-inference sample repetition -1",
          snapshotVoicedMs: metrics.find((m) => m.metric === "prepare")?.snapshotMs,
          firstSnapshotMs: metrics.find((m) => m.metric === "prepare")?.firstSnapshotMs,
          memorySampling: "100ms requested companion process RSS through session; per-ASR MLX active/peak; overlapping metrics are not added",
          wavSha256: clips.map((clip) => createHash("sha256").update(clip).digest("hex")), samples,
          prepareMs: metrics.find((m) => m.metric === "prepare")?.prepareMs,
          maxPendingAudioMs: Math.max(0, ...queueSamples.map((m) => m.pendingAudioMs)),
          maxPendingTranslationMs: Math.max(0, ...queueSamples.map((m) => m.pendingTranslationMs)),
          sampledProcessRssPeakBytes: Math.max(0, ...queueSamples.filter((m) => m.metric === "sample").map((m) => m.processRssBytes)),
          droppedFrames: receipts.at(-1)?.droppedFrames, droppedUtterances: receipts.at(-1)?.droppedUtterances,
          droppedTranslations: receipts.at(-1)?.droppedTranslations, coalescedSnapshots: receipts.at(-1)?.coalescedSnapshots };
        for (const clip of [0, 1]) for (const field of ["firstPaintFromVoiceStartMs", "finalPaintFromVoiceEndMs"]) {
          const values = samples.filter((s) => s.clip === clip && s.repetition >= 0 && s[field] !== null).map((s) => s[field]).sort((a, b) => a - b);
          report[`clip${clip}.${field}`] = { n: values.length, p50Ms: values[Math.ceil(values.length * .5) - 1] ?? null,
            p95Ms: values[Math.ceil(values.length * .95) - 1] ?? null };
        }
        report.checks = { sampleChecks: samples.every((s) => Object.values(s.checks).every(Boolean)),
          boundedQueues: report.maxPendingAudioMs <= 8000 && report.maxPendingTranslationMs <= 8000,
          noDrops: report.droppedFrames === 0 && report.droppedUtterances === 0 && report.droppedTranslations === 0 };
        if (phase === "after") {
          const before = JSON.parse(await readFile(".ralph/interim-browser-before.json", "utf8"));
          report.checks.sameAudio = JSON.stringify(report.wavSha256) === JSON.stringify(before.wavSha256);
          report.checks.firstPaintImproved = [0, 1].every((clip) => report[`clip${clip}.firstPaintFromVoiceStartMs`].p50Ms < before[`clip${clip}.firstPaintFromVoiceStartMs`].p50Ms);
        }
        report.acceptancePassed = Object.values(report.checks).every(Boolean);
        await mkdir("docs/verification/interim", { recursive: true });
        await writeFile(`docs/verification/interim/browser-${phase}${trial ? `-${trial}` : ""}${report.acceptancePassed ? "" : "-failed"}.json`, `${JSON.stringify(report, null, 2)}\n`);
        if (phase === "before") await writeFile(".ralph/interim-browser-before.json", `${JSON.stringify(report, null, 2)}\n`);
        measured = true;
        console.log(JSON.stringify({ report: report.checks, acceptancePassed: report.acceptancePassed }));
        assert.ok(report.acceptancePassed, "Native interim comparison checks failed; numeric failed report preserved");
      }
      if (command === "continuous") {
        assert.ok(finishTrace && !measured);
        const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
        assert.equal(captureStatus.state, "capturing");
        // The initial message can arrive while a final is waiting behind older
        // text. Trace its later DOM appearance and require a covering Paint then.
        await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
          const waiting = new Map();
          let shadow;
          const observe = () => {
            const next = document.querySelector("#interpreter-captions")?.shadowRoot;
            if (next && next !== shadow) { shadow = next; observer.observe(shadow, { subtree: true, childList: true, characterData: true }); }
            for (const [id, caption] of waiting) {
              const node = [...(shadow?.querySelectorAll(".sentence") ?? [])].find((node) => node.dataset.utteranceId === id);
              const text = node?.textContent ?? "";
              if (!node?.isConnected || !text || !caption.translation.includes(text)) continue;
              const box = node.getBoundingClientRect();
              performance.mark(`interpreter-caption:${JSON.stringify({
                sessionId: caption.sessionId, utteranceId: id, revision: caption.revision, final: caption.final,
                audioEndMs: caption.audioEndMs, type: "visibility", atMs: performance.timeOrigin + performance.now(),
                visible: true, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              })}`);
              waiting.delete(id);
            }
          };
          const observer = new MutationObserver(observe);
          observer.observe(document.documentElement, { subtree: true, childList: true });
          chrome.runtime.onMessage.addListener((message, sender) => {
            if (sender.id !== chrome.runtime.id || message.target !== "captions") return;
            if (message.type === "clear" || message.type === "start") { waiting.clear(); return; }
            if (message.type !== "caption") return;
            const caption = message.caption;
            const root = document.querySelector("#interpreter-captions")?.shadowRoot;
            const node = [...(root?.querySelectorAll(".sentence") ?? [])].find((node) => node.dataset.utteranceId === caption.utteranceId);
            const text = node?.textContent ?? "";
            if (node?.isConnected && text && caption.translation.includes(text)) waiting.delete(caption.utteranceId);
            else waiting.set(caption.utteranceId, caption);
            observe();
          });
        } }), tabId);
        const start = metrics.length;
        const trials = [];
        for (let repetition = 0; repetition < 3; repetition++) {
          for (let clip = 0; clip < clips.length; clip++) {
            const media = await page.locator("audio").evaluate(async (element, index) => {
              element.src = `/${index}.wav`;
              globalThis.continuousEnded = new Promise((ready, reject) => {
                element.addEventListener("ended", () => ready({ ended: element.ended, currentTime: element.currentTime }), { once: true });
                element.addEventListener("error", () => reject(new Error("Audio playback failed")), { once: true });
              });
              const playing = new Promise((ready) => element.addEventListener("playing", () => ready({
                originMs: performance.timeOrigin + performance.now() - element.currentTime * 1000,
                durationMs: element.duration * 1000,
              }), { once: true }));
              await element.play();
              return playing;
            }, clip);
            trials.push({ repetition, clip, ...media, ...bounds[clip] });
            if (repetition === 0 && clip === 2) {
              await page.waitForTimeout(2000);
              await page.screenshot({ path: `${profile}/continuous-long.png` });
            }
            const playback = await page.evaluate(() => globalThis.continuousEnded);
            assert.ok(playback.ended && Math.abs(playback.currentTime * 1000 - media.durationMs) < 20);
            await page.waitForTimeout(400);
          }
        }
        const observed = () => metrics.slice(start).filter((m) => m.sessionId === captureStatus.sessionId);
        const deadline = Date.now() + 90000;
        while (true) {
          const captions = observed().filter((m) => m.metric === "caption");
          const receipt = observed().filter((m) => m.metric === "receipt").at(-1);
          const ids = new Set(captions.map((c) => c.utteranceId));
          if (captions.length && captions.at(-1).atMs > trials.at(-1).originMs
            && [...ids].every((id) => captions.some((c) => c.utteranceId === id && c.final))
            && receipt?.pendingAudioMs === 0 && receipt.pendingTranslationMs === 0
            && Date.now() - captions.at(-1).atMs >= 2000) break;
          assert.ok(Date.now() < deadline, "Continuous captions did not finalize and drain");
          await page.waitForTimeout(20);
        }
        // Observe waiting captions through their actual appearance; inference
        // drain alone does not establish that the sink has displayed them.
        await page.waitForFunction(() => !document.querySelector("#interpreter-captions"), undefined, { timeout: 90000 });
        const rows = await finishTrace(); finishTrace = undefined;
        const review = await worker.evaluate(async (id) => {
          const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.interimCaptions });
          return result;
        }, tabId);
        const captions = observed().filter((m) => m.metric === "caption");
        const assigned = new Set();
        for (const trial of trials) {
          trial.captions = captions.filter((c) => {
            // The VAD end can extend into its trailing silence. Label the segment
            // by its audio interval center; retain the original bounds for timing.
            const center = c.originMs + (c.audioStartMs + c.audioEndMs) / 2 - trial.originMs;
            return trial.voiceStartMs - 200 <= center && center <= trial.voiceEndMs + 200;
          });
          for (const caption of trial.captions) assigned.add(caption);
          const ids = new Set(trial.captions.map((c) => c.utteranceId));
          const finals = review.filter((c) => ids.has(c.utteranceId) && c.final);
          const source = finals.map((c) => c.source).join(" ").toLowerCase();
          const translation = finals.map((c) => c.translation).join(" ");
          console.log(JSON.stringify({ review: [trial.repetition, trial.clip], source, translation }));
          trial.sourceCorrections = [...ids].reduce((sum, id) => {
            const values = review.filter((c) => c.utteranceId === id);
            return sum + values.filter((c, i) => i > 0 && c.source !== values[i - 1].source).length;
          }, 0);
          trial.revisions = rows.filter((r) => ["caption", "visibility"].includes(r.type) && ids.has(r.utteranceId)).map((r) => {
            const caption = trial.captions.find((c) => c.utteranceId === r.utteranceId && c.revision === r.revision);
            assert.ok(caption);
            return { ...r, audioPositionToPaintMs: r.paintAtMs !== null ? r.paintAtMs - caption.originMs - r.audioEndMs : null };
          });
          const paints = trial.revisions.filter((r) => r.paintAtMs !== null);
          const finalPaints = [...new Map(paints.filter((r) => r.final).map((r) => [r.utteranceId, r])).values()];
          trial.firstPaintFromVoiceStartMs = paints.length ? paints[0].paintAtMs - trial.originMs - trial.voiceStartMs : null;
          trial.lastFinalPaintFromVoiceEndMs = finalPaints.length ? finalPaints.at(-1).paintAtMs - trial.originMs - trial.voiceEndMs : null;
          trial.duringSpeechPaints = paints.filter((r) => !r.final && r.paintAtMs < trial.originMs + trial.voiceEndMs).length;
          trial.checks = { korean: /[가-힣]/.test(translation),
            allDisplayedCuesFinalize: ids.size > 0 && [...ids].every((id) => finals.filter((c) => c.utteranceId === id).length === 1),
            increasingRevisions: [...ids].every((id) => {
              const revisions = trial.captions.filter((c) => c.utteranceId === id).map((c) => c.revision);
              return JSON.stringify(revisions) === JSON.stringify([...new Set(revisions)].sort((a, b) => a - b));
            }),
            everyFinalPaint: finals.length > 0 && finalPaints.length === finals.length,
            ...(trial.clip === 0 ? { sourceDetails: /sunny/.test(source) && /today/.test(source), todayMeaning: /오늘/.test(translation), sunnyMeaning: /맑|화창/.test(translation) }
              : trial.clip === 1 ? { sourceDetails: /crane/.test(source) && /steel/.test(source), craneMeaning: /크레인/.test(translation), steelMeaning: /철|강철/.test(translation) }
                : { sourceDetails: ["not cancel", "before noon", "blue umbrella", "station", "three", "afternoon"].every((word) => source.includes(word)),
                  negation: /취소/.test(translation) && /않|없|취소하지 말/.test(translation),
                  beforeNoon: /정오|12시/.test(translation) && /전/.test(translation),
                  blueUmbrella: /우산/.test(translation) && /파란|파랑|푸른/.test(translation),
                  station: /역/.test(translation), afternoonThree: /오후/.test(translation) && /3시|세 시/.test(translation) }),
            ...(phase === "after" ? { duringSpeech: trial.duringSpeechPaints > 0,
              ...(trial.clip > 0 ? { sourceCorrection: trial.sourceCorrections > 0 } : {}) } : {}) };
        }
        const queueSamples = observed().filter((m) => ["sample", "receipt"].includes(m.metric));
        const receipt = observed().filter((m) => m.metric === "receipt").at(-1);
        const preparation = metrics.find((m) => m.metric === "prepare");
        assert.ok(preparation);
        const report = { phase, browser: context.browser().version(), realTabCapture: true, realLocalModels: true,
          measurement: "continuous browser audio to covering main-frame Paint; estimated PCM origin; not acoustic timing",
          playback: "three rounds, nine advancing clips, 400ms added pause; no inference or subtitle expiry waits",
          coldWarm: "cached weights and OS caches, fresh engine, selected Ollama model unloaded; first sample includes first inference",
          baseline: ["first500", "first300"].includes(trial)
            ? "after first500 changes only first voiced threshold; subsequent 500ms cadence and all other settings identical"
            : "before disables only snapshots; models, prompt, VAD, preparation and token streaming identical",
          snapshotVoicedMs: metrics.find((m) => m.metric === "prepare")?.snapshotMs,
          firstSnapshotMs: metrics.find((m) => m.metric === "prepare")?.firstSnapshotMs,
          snapshotsEnabled: metrics.find((m) => m.metric === "prepare")?.snapshotsEnabled,
          modelSettings: { asrModel: preparation.asrModel, textModel: preparation.textModel,
            source: preparation.source, target: preparation.target, translationOptions: preparation.translationOptions },
          wavSha256: clips.map((clip) => createHash("sha256").update(clip).digest("hex")), trials, captions,
          asrCalls: observed().filter((m) => m.metric === "asr"), translationCalls: observed().filter((m) => m.metric === "translation"),
          queueAndRssSamples: queueSamples, prepareMs: metrics.find((m) => m.metric === "prepare")?.prepareMs,
          checks: { sampleChecks: trials.every((t) => Object.values(t.checks).every(Boolean)),
            allCaptionsAssigned: assigned.size === captions.length && trials.reduce((n, t) => n + t.captions.length, 0) === captions.length,
            boundedQueues: queueSamples.length > 0 && queueSamples.every((m) => m.pendingAudioMs <= 8000 && m.pendingTranslationMs <= 8000),
            queuesDrained: receipt.pendingAudioMs === 0 && receipt.pendingTranslationMs === 0,
            noDrops: receipt.droppedFrames === 0 && receipt.droppedUtterances === 0 && receipt.droppedTranslations === 0 } };
        for (const clip of [0, 1, 2]) for (const field of ["firstPaintFromVoiceStartMs", "lastFinalPaintFromVoiceEndMs"]) {
          // Exclude the entire first round; n=2 warm samples per clip.
          const values = trials.filter((t) => t.clip === clip && t.repetition > 0 && t[field] !== null).map((t) => t[field]).sort((a, b) => a - b);
          report[`clip${clip}.${field}`] = { n: values.length, p50Ms: values[Math.ceil(values.length * .5) - 1] ?? null,
            p95Ms: values[Math.ceil(values.length * .95) - 1] ?? null };
        }
        if (phase === "after" && trial !== "first500") {
          const baseline = trial === "first300" ? ".ralph/interim-continuous-browser-first500.json" : ".ralph/interim-continuous-browser-before.json";
          const before = JSON.parse(await readFile(baseline, "utf8"));
          report.comparisonBaseline = baseline;
          report.checks.sameAudio = JSON.stringify(report.wavSha256) === JSON.stringify(before.wavSha256);
          if (trial === "first300") {
            report.checks.sameSettingsExceptFirstSnapshot = ["browser", "realTabCapture", "realLocalModels", "measurement", "playback", "coldWarm", "baseline", "snapshotVoicedMs", "snapshotsEnabled"]
              .every((key) => report[key] === before[key])
              && JSON.stringify(report.modelSettings) === JSON.stringify(before.modelSettings)
              && before.firstSnapshotMs === 500 && report.firstSnapshotMs === 300;
          }
          report.checks.firstPaintImproved = [0, 1, 2].every((clip) => {
            const a = report[`clip${clip}.firstPaintFromVoiceStartMs`], b = before[`clip${clip}.firstPaintFromVoiceStartMs`];
            return a.n === 2 && b.n === 2 && a.p50Ms < b.p50Ms && a.p95Ms < b.p95Ms;
          });
        }
        report.acceptancePassed = Object.values(report.checks).every(Boolean);
        await mkdir("docs/verification/interim", { recursive: true });
        await writeFile(`docs/verification/interim/continuous-browser-${phase}${trial ? `-${trial}` : ""}${report.acceptancePassed ? "" : "-failed"}.json`, `${JSON.stringify(report, null, 2)}\n`);
        if (phase === "before") await writeFile(".ralph/interim-continuous-browser-before.json", `${JSON.stringify(report, null, 2)}\n`);
        if (trial === "first500") await writeFile(".ralph/interim-continuous-browser-first500.json", `${JSON.stringify(report, null, 2)}\n`);
        measured = true;
        console.log(JSON.stringify({ report: report.checks, acceptancePassed: report.acceptancePassed, screenshot: `${profile}/continuous-long.png` }));
        assert.ok(report.acceptancePassed, "Continuous native interim checks failed; numeric failed report preserved");
      }
      if (command === "stopped") {
        const { captureStatus } = await worker.evaluate(() => chrome.storage.session.get("captureStatus"));
        const captured = await worker.evaluate(() => chrome.tabCapture.getCapturedTabs());
        const offscreen = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }));
        assert.equal(captureStatus.state, "idle");
        assert.equal(captured.some((tab) => tab.status === "active"), false);
        assert.equal(offscreen.length, 0);
        assert.equal(await page.locator("#interpreter-captions").count(), 0);
        stopped = true;
        console.log(JSON.stringify({ stopped: true, captionHosts: 0, offscreenContexts: 0 }));
      }
    } catch (error) { failed = true; console.log(JSON.stringify({ error: String(error) })); }
  }
} finally {
  input?.close(); process.stdin.pause();
  if (finishTrace) await finishTrace().catch(() => {});
  await context?.close();
  if (companion?.pid && companion.exitCode === null) {
    const exited = once(companion, "exit"); companion.kill("SIGINT"); await exited;
  }
  await new Promise((closed) => fixture.close(closed));
  if (failed || !measured || !stopped) process.exitCode = 1;
}
