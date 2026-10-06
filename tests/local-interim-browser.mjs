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
assert.ok([undefined, "interval500", "interval1000"].includes(trial));
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
    <style>body{margin:0;background:#446879;color:white;font:24px system-ui}main{padding:48px}audio{width:80%}</style>
    <main><h1>Generated English speech</h1><p>Snapshot comparison: ${phase}</p><audio controls></audio></main></html>`);
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
    body: JSON.stringify({ model: "qwen3:4b-instruct", keep_alive: 0 }),
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
  finishTrace = await traceCaptionPaints(context, page, worker, tabId);
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    globalThis.interimCaptions = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.id === chrome.runtime.id && message.target === "captions" && message.type === "caption") globalThis.interimCaptions.push(message.caption);
    });
  } }), tabId);
  console.log(JSON.stringify({ ready: true, browser: context.browser().version(), phase, profile,
    instructions: "Native Extensions toolbar → Interpreter → Start; close popup. measure (isolated short clips) OR continuous (nine clips without inference/expiry waits) → native Stop → stopped → exit. Failed semantic reports still require Stop cleanup." }));
  input = createInterface({ input: process.stdin });
  for await (const command of input) {
    try {
      if (command === "exit") break;
      if (command === "check") console.log(JSON.stringify(await worker.evaluate(() => chrome.storage.session.get("captureStatus"))));
      if (command === "measure") {
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
        const report = { phase, browser: context.browser().version(), realTabCapture: true, realLocalModels: true,
          measurement: "continuous browser audio to covering main-frame Paint; estimated PCM origin; not acoustic timing",
          playback: "three rounds, nine advancing clips, 400ms added pause; no inference or subtitle expiry waits",
          coldWarm: "cached weights and OS caches, fresh engine, selected Ollama model unloaded; first sample includes first inference",
          baseline: "before disables only snapshots; models, prompt, VAD, preparation and token streaming identical",
          snapshotVoicedMs: metrics.find((m) => m.metric === "prepare")?.snapshotMs,
          firstSnapshotMs: metrics.find((m) => m.metric === "prepare")?.firstSnapshotMs,
          snapshotsEnabled: metrics.find((m) => m.metric === "prepare")?.snapshotsEnabled,
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
        if (phase === "after") {
          const before = JSON.parse(await readFile(".ralph/interim-continuous-browser-before.json", "utf8"));
          report.checks.sameAudio = JSON.stringify(report.wavSha256) === JSON.stringify(before.wavSha256);
          report.checks.firstPaintImproved = [0, 1, 2].every((clip) => {
            const a = report[`clip${clip}.firstPaintFromVoiceStartMs`], b = before[`clip${clip}.firstPaintFromVoiceStartMs`];
            return a.n === 2 && b.n === 2 && a.p50Ms < b.p50Ms && a.p95Ms < b.p95Ms;
          });
        }
        report.acceptancePassed = Object.values(report.checks).every(Boolean);
        await mkdir("docs/verification/interim", { recursive: true });
        await writeFile(`docs/verification/interim/continuous-browser-${phase}${trial ? `-${trial}` : ""}${report.acceptancePassed ? "" : "-failed"}.json`, `${JSON.stringify(report, null, 2)}\n`);
        if (phase === "before") await writeFile(".ralph/interim-continuous-browser-before.json", `${JSON.stringify(report, null, 2)}\n`);
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
