import type { SessionSettings } from "./capture/settings";
import type { CaptureCommand, CaptureStatus } from "./capture/contracts";
import { createTabAudioSource } from "./capture/tab-audio";

const companion = "http://127.0.0.1:8765";
let status: CaptureStatus = { state: "idle", message: "Ready to capture tab audio." };
let socket: WebSocket | undefined;
let source: ReturnType<typeof createTabAudioSource> | undefined;
let generation = 0;

function report(next: CaptureStatus) {
  status = next;
  void chrome.runtime.sendMessage({ target: "worker", type: "capture-status", status }).catch(() => {});
}

async function stop(next: CaptureStatus = { state: "idle", message: "Capture stopped." }) {
  generation++;
  const oldSource = source;
  const oldSocket = socket;
  source = undefined;
  socket = undefined;
  await oldSource?.stop();
  if (oldSocket) {
    oldSocket.onmessage = null;
    oldSocket.onerror = null;
    oldSocket.onclose = null;
    if (oldSocket.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1000);
        oldSocket.onclose = () => { clearTimeout(timeout); resolve(); };
        oldSocket.close(1000, "Capture stopped");
      });
    }
  }
  report(next);
}

async function start(streamId: string, tabId: number, settings?: SessionSettings) {
  await stop();
  const started = ++generation;
  report({ state: "starting", tabId, message: "Connecting to companion…" });
  try {
    const response = await fetch(`${companion}/sessions`, {
      method: "POST",
      ...(settings ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) } : {}),
      signal: AbortSignal.timeout(5000),
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
    const connection = new WebSocket("ws://127.0.0.1:8765/audio");
    socket = connection;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Companion connection timed out.")), 5000);
      connection.onopen = () => connection.send(JSON.stringify({ sessionId, token }));
      connection.onerror = () => { clearTimeout(timeout); reject(new Error("Cannot connect to companion.")); };
      connection.onclose = () => { clearTimeout(timeout); reject(new Error("Companion rejected the capture session.")); };
      connection.onmessage = (event) => {
        const reply = JSON.parse(event.data);
        clearTimeout(timeout);
        if (reply.type === "ready" && reply.sessionId === sessionId) resolve();
        else reject(new Error("Companion did not accept the audio session."));
      };
    });
    connection.onmessage = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.sessionId !== sessionId || socket !== connection) return;
      if (reply.type === "receipt") {
        const dropped = (reply.droppedFrames ?? 0) + (reply.droppedUtterances ?? 0);
        report({ ...status, frames: reply.frames, samples: reply.samples, peak: reply.peak,
          ...(dropped > 0 ? { message: `Translation is behind; dropped ${reply.droppedFrames ?? 0} frames and ${reply.droppedUtterances ?? 0} waiting speech segments.` } : {}),
        });
      } else if (reply.type === "caption" && reply.caption?.sessionId === sessionId) {
        void chrome.runtime.sendMessage({ target: "worker", type: "caption", caption: reply.caption }).catch(() => {});
      } else if (reply.type === "status") {
        report({ ...status, message: reply.message });
      } else if (reply.type === "error") {
        void stop({ state: "error", message: reply.message });
      }
    };
    connection.onclose = () => {
      if (socket === connection) void stop({ state: "error", message: "Companion disconnected. Start again to reconnect." });
    };
    connection.onerror = () => {
      if (socket === connection) void stop({ state: "error", message: "Companion connection failed. Start again to reconnect." });
    };
    const audio = createTabAudioSource(() => {
      if (socket === connection) void stop({ state: "idle", message: "Captured tab closed or audio ended." });
    });
    source = audio;
    await audio.start(streamId, (packet) => {
      if (socket !== connection || connection.readyState !== WebSocket.OPEN) return;
      // At most one second of PCM can wait in the browser's transport buffer.
      if (connection.bufferedAmount + packet.byteLength > 50 * packet.byteLength) {
        void stop({ state: "error", message: "Companion is too slow. Capture stopped to avoid an audio backlog." });
        return;
      }
      connection.send(packet);
    });
    if (started !== generation) { await audio.stop(); return status; }
    report({ state: "capturing", sessionId, tabId, message: "Speech translation is listening. Subtitles appear as speech is translated." });
  } catch (error) {
    if (started === generation) {
      await stop({ state: "error", message: error instanceof Error ? error.message : "Tab audio capture failed." });
    }
  }
  return status;
}

chrome.runtime.onMessage.addListener((message: CaptureCommand, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("service-worker.js")) return;
  if (message.target !== "offscreen") return;
  if (message.type === "status") { respond(status); return; }
  const task = message.type === "start" ? start(message.streamId, message.tabId, message.settings) : stop().then(() => status);
  void task.then(respond);
  return true;
});
