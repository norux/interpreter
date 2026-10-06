// Installed, relocated app + actual Chrome native messaging; no repository Python/uv.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";

const app = process.env.INTERPRETER_COMPANION_APP;
if (!app) throw new Error("Set INTERPRETER_COMPANION_APP to the installed .app path.");
execFileSync("codesign", ["--verify", "--strict", app]);
for (const url of ["http://127.0.0.1:8765/health", "http://127.0.0.1:11434/api/tags"]) {
  const existing = await fetch(url).catch(() => undefined);
  assert.ok(!existing, "Stop your manual servers before this owned startup/shutdown test.");
}
const config = JSON.parse(await readFile(`${app}/Contents/Resources/companion.json`, "utf8"));
const profile = await mkdtemp(`${tmpdir()}/interpreter-native-browser-`);
// Chrome also searches this owned profile directory for native host manifests.
await mkdir(`${profile}/NativeMessagingHosts`, { recursive: true });
const { writeFile } = await import("node:fs/promises");
await writeFile(`${profile}/NativeMessagingHosts/com.norux.interpreter.json`, JSON.stringify({
  name: "com.norux.interpreter", description: "Installed Interpreter companion test",
  path: `${resolve(app)}/Contents/MacOS/Interpreter Companion`, type: "stdio",
  allowed_origins: [`chrome-extension://${config.extensionId}/`],
}));
let context;
try {
  const extension = resolve("extension/dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  assert.equal(new URL(worker.url()).host, config.extensionId);
  const connected = await worker.evaluate(async () => {
    globalThis.nativePort = chrome.runtime.connectNative("com.norux.interpreter");
    return new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("Native companion timed out")), 30000);
      globalThis.nativePort.onDisconnect.addListener(() => {
        clearTimeout(timeout);
        reject(new Error(chrome.runtime.lastError?.message ?? "Disconnected"));
      });
      globalThis.nativePort.onMessage.addListener((message) => {
        clearTimeout(timeout);
        if (message.type === "ready") resolveReady(message);
        else reject(new Error(message.message));
      });
      globalThis.nativePort.postMessage({ type: "start", localTranslation: true });
    });
  });
  assert.equal(connected.type, "ready");
  assert.equal((await fetch("http://127.0.0.1:8765/health")).status, 200);
  assert.equal((await fetch("http://127.0.0.1:11434/api/tags")).status, 200);
  const preparation = await worker.evaluate(async () => {
    const response = await fetch("http://127.0.0.1:8765/sessions", { method: "POST" });
    if (!response.ok) throw new Error(`Configured extension origin failed: ${response.status}`);
    const auth = await response.json();
    const socket = new WebSocket("ws://127.0.0.1:8765/audio");
    return new Promise((resolvePrepared, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error("Packaged local model preparation timed out")); }, 65000);
      socket.onopen = () => socket.send(JSON.stringify(auth));
      socket.onerror = () => { clearTimeout(timeout); reject(new Error("Audio socket failed")); };
      socket.onmessage = (event) => {
        clearTimeout(timeout);
        const message = JSON.parse(event.data);
        socket.close();
        if (message.type === "ready") resolvePrepared(true);
        else reject(new Error(message.message));
      };
    });
  });
  assert.equal(preparation, true, "Bundled Python/MLX/Ollama load cached default models after relocation");
  execFileSync("codesign", ["--verify", "--strict", app]);
  const stopped = await worker.evaluate(() => new Promise((resolveStopped, reject) => {
    const timeout = setTimeout(() => reject(new Error("Native shutdown timed out")), 15000);
    globalThis.nativePort.onMessage.addListener((message) => {
      if (message.type === "stopped") { clearTimeout(timeout); globalThis.nativePort.disconnect(); resolveStopped(true); }
    });
    globalThis.nativePort.postMessage({ type: "stop" });
  }));
  assert.equal(stopped, true);
  execFileSync("codesign", ["--verify", "--strict", app]);
  for (const url of ["http://127.0.0.1:8765/health", "http://127.0.0.1:11434/api/tags"]) {
    assert.equal(await fetch(url).then(() => true, () => false), false, "Owned server must be gone when Stop is acknowledged");
  }
  console.log(JSON.stringify({ passed: true, installedApp: true, browser: context.browser().version(),
    nativeMessaging: true, ownedEngines: true, configuredOrigin: true, modelPreparation: true,
    stoppedEngines: true, realAudioOrPaint: false }));
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
