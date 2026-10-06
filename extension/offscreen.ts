import { FRAMEWORK_VERSION, type MediaTargetId } from "../packages/contracts";
import { createAudioQueue } from "../packages/core/audio-queue";
import { companionLimits, createCompanionEngine, decodeCompanionPCM } from "../packages/engines-companion/engine";
import { createCompanionTransport } from "../packages/engines-companion/transport";
import { displayCaption } from "./captions/presentation";
import type { SessionSettings } from "./capture/settings";
import type { CaptureCommand, CaptureStatus } from "./capture/contracts";
import { createTabAudioSource } from "./capture/tab-audio";

const companion = "http://127.0.0.1:8765";
let status: CaptureStatus = { state: "idle", message: "Ready to capture tab audio." };
let engine: ReturnType<typeof createCompanionEngine> | undefined;
let queue: ReturnType<typeof createAudioQueue> | undefined;
let source: ReturnType<typeof createTabAudioSource> | undefined;
let generation = 0;
let startup: AbortController | undefined;

function report(next: CaptureStatus) {
  status = next;
  void chrome.runtime.sendMessage({ target: "worker", type: "capture-status", status }).catch(() => {});
}

async function stop(next: CaptureStatus = { state: "idle", message: "Capture stopped." }) {
  generation++;
  startup?.abort();
  startup = undefined;
  const oldSource = source;
  const oldEngine = engine;
  queue?.close();
  queue = undefined;
  source = undefined;
  engine = undefined;
  try { await oldSource?.stop(); }
  finally { await oldEngine?.close(); }
  report(next);
}

async function start(tabId: number, settings?: SessionSettings) {
  const selected = settings ? { ...settings } : undefined;
  await stop();
  const started = ++generation;
  const controller = new AbortController();
  startup = controller;
  report({ state: "starting", tabId, message: "Connecting to companion…" });
  try {
    const response = await fetch(`${companion}/sessions`, {
      method: "POST",
      ...(selected ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected) } : {}),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) {
      throw new Error(response.status === 403
        ? "Set INTERPRETER_EXTENSION_ID on the companion to this extension's ID."
        : response.status === 422
          ? "Invalid language or model selection. Check the popup settings."
          : "Companion is busy. Stop the other capture first.");
    }
    const { sessionId, token } = await response.json() as { sessionId: string; token: string };
    if (started !== generation) return status;
    if (typeof sessionId !== "string" || !sessionId || typeof token !== "string" || !token) throw new Error("Invalid companion session response.");
    // A legacy tab-output identity is never issued as a selected-video handle.
    const identity = { sessionId, targetId: "legacy-tab-output" as MediaTargetId, epoch: 0 };
    const connection = createCompanionEngine(sessionId, createCompanionTransport(sessionId, token, controller.signal), selected, (reply) => {
      if (started !== generation || engine !== connection) return;
      const dropped = reply.droppedFrames + reply.droppedUtterances;
      report({ ...status, frames: reply.frames, samples: reply.samples, peak: reply.peak,
        ...(dropped > 0 ? { message: `Translation is behind; dropped ${reply.droppedFrames} frames and ${reply.droppedUtterances} waiting speech segments.` } : {}),
      });
    });
    engine = connection;
    report({ state: "starting", tabId, message: "Preparing translation session…" });
    const languages = selected ? { source: selected.sourceLanguage, target: selected.targetLanguage } : { source: "und", target: "und" };
    await connection.prepare(identity, languages);
    if (started !== generation || engine !== connection) return status;
    const streamId = await chrome.runtime.sendMessage({ target: "worker", type: "stream-id", tabId }) as string;
    if (started !== generation || engine !== connection) return status;
    if (!streamId) throw new Error("Capture stopped before audio permission was acquired.");
    const audioQueue = createAudioQueue(identity, companionLimits);
    queue = audioQueue;
    void (async () => {
      for await (const event of connection.run(audioQueue.stream)) {
        if (started !== generation || engine !== connection) break;
        if (event.type === "paired-caption") {
          void chrome.runtime.sendMessage({ target: "worker", type: "caption", caption: {
            ...displayCaption(event.caption), emittedAtMs: event.emittedAtMs, framework: { version: FRAMEWORK_VERSION, message: { type: "paired-caption", caption: event.caption } },
          } }).catch(() => {});
        } else if (event.type === "status") {
          if (event.status.state === "failed") { await stop({ state: "error", message: event.status.message }); break; }
          report({ ...status, message: event.status.message });
        }
      }
    })().catch((error) => {
      if (started === generation && engine === connection) void stop({ state: "error", message: error instanceof Error ? error.message : "Companion interpretation failed." });
    });
    const audio = createTabAudioSource(() => {
      if (engine === connection) void stop({ state: "idle", message: "Captured tab closed or audio ended." });
    });
    source = audio;
    await audio.start(streamId, (packet) => {
      if (engine !== connection || started !== generation) return;
      try {
        if (audioQueue.push(decodeCompanionPCM(packet, identity)).state !== "accepted") {
          void stop({ state: "error", message: "Companion is too slow. Capture stopped to avoid an audio backlog." });
        }
      } catch (error) {
        void stop({ state: "error", message: error instanceof Error ? error.message : "Invalid tab audio frame." });
      }
    });
    if (started !== generation) { await audio.stop(); return status; }
    startup = undefined;
    report({ state: "capturing", sessionId, tabId, message: "Speech translation is listening. Subtitles appear as speech is translated." });
  } catch (error) {
    if (started === generation) {
      await stop({ state: "error", message: error instanceof Error ? error.message : "Tab audio capture failed." });
    } else {
      return { state: "idle", message: "Capture stopped during startup." };
    }
  }
  return status;
}

chrome.runtime.onMessage.addListener((message: CaptureCommand, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("service-worker.js")) return;
  if (message.target !== "offscreen") return;
  if (message.type === "status") { respond(status); return; }
  const task = message.type === "start" ? start(message.tabId, message.settings) : stop().then(() => status);
  void task.then(respond);
  return true;
});
