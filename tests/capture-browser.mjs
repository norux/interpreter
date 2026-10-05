// Real browser worklet/loopback smoke. This does not substitute for tabCapture acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

await mkdir(".ralph", { recursive: true });
const profile = await mkdtemp(resolve(".ralph/worklet-browser-"));
let context;
let server;
let debuggerSocket;
let serverLog = "";

try {
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--remote-debugging-port=0",
    ],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  server = spawn("uv", [
    "run", "--locked", "uvicorn", "server.app:app", "--host", "127.0.0.1",
    "--port", "8765", "--ws-max-size", "4096", "--ws-max-queue", "8",
  ], { env: { ...process.env, INTERPRETER_EXTENSION_ID: extensionId }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; });
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Companion did not start: ${serverLog}`)), 10000);
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.stderr.on("data", () => {
      if (serverLog.includes("Uvicorn running on")) { clearTimeout(timeout); resolveReady(); }
    });
    server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Companion exited ${code}: ${serverLog}`)); });
  });
  assert.equal((await fetch("http://127.0.0.1:8765/health")).status, 200);
  await worker.evaluate(() => chrome.offscreen.createDocument({
    url: "offscreen.html", reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Verify PCM worklet and companion transport using generated test audio.",
  }));
  assert.equal((await worker.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "status" }))).state, "idle");
  const [port] = (await readFile(`${profile}/DevToolsActivePort`, "utf8")).split("\n");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((entry) => entry.url === `chrome-extension://${extensionId}/offscreen.html`);
  assert.ok(target, "Offscreen document missing");
  debuggerSocket = new WebSocket(target.webSocketDebuggerUrl);
  await once(debuggerSocket, "open");
  const result = await new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => reject(new Error("Browser worklet check timed out")), 15000);
    debuggerSocket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      if (message.error || message.result.exceptionDetails) {
        reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
      } else resolveResult(message.result.result.value);
    };
    debuggerSocket.send(JSON.stringify({
      id: 1, method: "Runtime.evaluate", params: {
        expression: `(${workletSmoke.toString()})()`, awaitPromise: true,
        returnByValue: true, userGesture: true,
      },
    }));
  });
  assert.equal(result.inputRate, 44100);
  assert.equal(result.frames, 50);
  assert.equal(result.samples, 24000);
  assert.ok(result.peak > 2500 && result.peak < 4000, `Unexpected generated-tone peak: ${result.peak}`);
  console.log(JSON.stringify({ browser: context.browser().version(), ...result, tabCapture: "not exercised" }));
} finally {
  debuggerSocket?.close();
  await context?.close();
  if (server && server.exitCode === null && server.pid) {
    const exited = once(server, "exit");
    server.kill("SIGINT");
    await exited;
  }
}

async function workletSmoke() {
  const response = await fetch("http://127.0.0.1:8765/sessions", { method: "POST" });
  if (!response.ok) throw new Error(`Extension origin rejected: ${response.status}`);
  const auth = await response.json();
  const socket = new WebSocket("ws://127.0.0.1:8765/audio");
  const context = new AudioContext({ sampleRate: 44100 });
  let oscillator;
  let worklet;
  try {
    await new Promise((resolveReady, reject) => {
      socket.onopen = () => socket.send(JSON.stringify(auth));
      socket.onerror = () => reject(new Error("Socket error"));
      socket.onmessage = ({ data }) => {
        if (JSON.parse(data).type === "ready") resolveReady();
        else reject(new Error("Companion rejected session"));
      };
    });
    await context.audioWorklet.addModule(chrome.runtime.getURL("worklet.js"));
    worklet = new AudioWorkletNode(context, "tab-pcm");
    oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    const gain = context.createGain();
    gain.gain.value = 0.1;
    oscillator.connect(gain).connect(worklet).connect(context.destination);
    worklet.port.onmessage = ({ data }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    };
    const received = new Promise((resolveReceipt, reject) => {
      const timeout = setTimeout(() => reject(new Error("No PCM receipt")), 8000);
      socket.onmessage = ({ data }) => {
        const reply = JSON.parse(data);
        if (reply.type === "error") { clearTimeout(timeout); reject(new Error(reply.message)); }
        if (reply.type === "receipt" && reply.frames >= 50) { clearTimeout(timeout); resolveReceipt(reply); }
      };
    });
    oscillator.start();
    await context.resume();
    const receipt = await received;
    return { inputRate: context.sampleRate, frames: receipt.frames, samples: receipt.samples, peak: receipt.peak };
  } finally {
    oscillator?.stop();
    worklet?.port.close();
    worklet?.disconnect();
    await context.close();
    socket.close(1000);
  }
}
