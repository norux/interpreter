import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { createCompanionConnection } from "../extension/companion";

test("native companion starts on demand, waits for owned shutdown and handles cancellation/missing installation", async (t) => {
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const originalFetch = globalThis.fetch;
  let healthy = false;
  let lastError: { message: string } | undefined;
  const ports: ReturnType<typeof fakePort>[] = [];
  const failures: string[] = [];
  function fakePort() {
    const messages: unknown[] = [];
    const listeners: ((message: { type: string; message?: string }) => void)[] = [];
    const disconnects: (() => void)[] = [];
    let closed = false;
    return {
      messages, get closed() { return closed; },
      onMessage: { addListener: (callback: typeof listeners[number]) => listeners.push(callback) },
      onDisconnect: { addListener: (callback: () => void) => disconnects.push(callback) },
      postMessage: (message: unknown) => { messages.push(message); },
      disconnect: () => { if (!closed) { closed = true; for (const callback of disconnects) callback(); } },
      reply: (message: { type: string; message?: string }) => { for (const callback of listeners) callback(message); },
    };
  }
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: { runtime: {
    get lastError() { return lastError; },
    connectNative(name: string) { assert.equal(name, "com.norux.interpreter"); const port = fakePort(); ports.push(port); return port; },
  } } });
  globalThis.fetch = async () => { if (!healthy) throw new TypeError("Network unavailable"); return new Response('{"status":"ok"}'); };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalChrome) Object.defineProperty(globalThis, "chrome", originalChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  const companion = createCompanionConnection((message) => failures.push(message));
  const first = companion.start(true);
  await setImmediate();
  assert.deepEqual(ports[0].messages, [{ type: "start", localTranslation: true }]);
  ports[0].reply({ type: "ready" });
  await first;
  let stopped = false;
  const stopping = companion.stop().then(() => { stopped = true; });
  await setImmediate();
  assert.equal(stopped, false, "Wait until owned processes actually stop before another Start");
  assert.deepEqual(ports[0].messages.at(-1), { type: "stop" });
  ports[0].reply({ type: "stopped" });
  await stopping;
  assert.equal(ports[0].closed, true);
  assert.deepEqual(failures, [], "Intentional Stop does not report an unexpected disconnect");

  const cancelled = companion.start(false);
  const cancelledCheck = assert.rejects(cancelled, /cancelled/);
  await setImmediate();
  const cancelStop = companion.stop();
  ports[1].reply({ type: "ready" });
  ports[1].reply({ type: "stopped" });
  await cancelStop;
  await cancelledCheck;

  const missing = companion.start(true);
  const missingCheck = assert.rejects(missing, (error: unknown) => error instanceof Error && "installRequired" in error && error.installRequired === true);
  await setImmediate();
  lastError = { message: "Specified native messaging host not found." };
  ports[2].disconnect();
  await missingCheck;
  lastError = undefined;

  const restarted = companion.start(true);
  await setImmediate();
  ports[3].reply({ type: "ready" });
  await restarted;
  ports[3].disconnect();
  assert.equal(failures.length, 1);
  healthy = true;
  await companion.start(true);
  assert.equal(ports.length, 4, "A manually started companion remains usable without spawning another host");
  await companion.stop();
});
