import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-preparation-build");
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: {
  outDir: output, rollupOptions: {
    input: { preparation: resolve("apps/chrome/preparation.html"), host: resolve("packages/engines-browser/execution-host.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" },
  },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/host-test") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<button id="prepare">Prepare</button><script type="module">
      import {createExecutionHost} from '/host.js';
      globalThis.statuses = [];
      globalThis.host = createExecutionHost(document, status => statuses.push(status));
      if (location.search === '?activation') globalThis.activationCheck = host.prepare().then(() => 'unexpected', error => error.message);
      document.querySelector('button').onclick = () => {
        globalThis.operation = host.prepare().then(status => {globalThis.result = status}, error => {globalThis.failure = error.message});
      };
    </script>`);
    return;
  }
  const file = resolve(output, `.${path}`);
  if (!file.startsWith(output + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const body = await readFile(file);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" })[extname(file)] ?? "application/octet-stream");
    // Packaged extension resources are local offline. This HTTP fixture caches
    // those same immutable build assets; model availability is tested separately.
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const observations = { scope: "B1 model preparation only; no PCM/ASR/translation accuracy", checks: [] };
try {
  // A real foreground tab switch is required for the document lifetime check.
  browser = await chromium.launch({ channel: "chromium", headless: false });
  observations.browser = browser.version();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  observations.consoleErrors = consoleErrors;
  const networkFailures = [];
  page.on("requestfailed", (request) => networkFailures.push({ url: request.url(), error: request.failure() }));
  await page.goto(`${origin}/host-test?activation`);
  await page.waitForFunction(() => globalThis.host);
  assert.match(await page.evaluate(() => globalThis.activationCheck), /Press Prepare/);
  observations.checks.push("Synthetic script call without user activation rejected");
  const initial = await page.evaluate(() => host.status());
  assert.equal(initial.state, "absent");
  observations.model = initial.model; observations.requiredBytes = initial.requiredBytes;
  await context.setOffline(true);
  await page.locator("#prepare").click();
  await page.waitForFunction(() => globalThis.failure);
  assert.equal(await page.evaluate(() => globalThis.failure), "offline-model-unavailable");
  assert.equal(await page.evaluate(() => statuses.at(-1).state), "failed");
  observations.checks.push("Offline first run explicitly unavailable");
  await context.setOffline(false);
  await page.goto(`${origin}/host-test`); await page.waitForFunction(() => globalThis.host);
  const denyDownload = (route) => route.abort("failed");
  await context.route("https://huggingface.co/**", denyDownload);
  await page.locator("#prepare").click();
  await page.waitForFunction(() => globalThis.failure);
  assert.equal(await page.evaluate(() => globalThis.failure), "download-required");
  assert.equal(await page.evaluate(() => host.status().then(status => status.state)), "absent");
  observations.checks.push("Injected first-download transport error never reports ready");
  await context.unroute("https://huggingface.co/**", denyDownload);
  // Hold one actual model request to prove Stop terminates an in-flight download.
  let release;
  let entered;
  const downloading = new Promise((ready) => { entered = ready; });
  const held = new Promise((ready) => { release = ready; });
  const hold = async (route) => { entered(); await held; await route.abort().catch(() => {}); };
  await context.route("https://huggingface.co/**", hold);
  await page.reload(); await page.waitForFunction(() => globalThis.host);
  await page.locator("#prepare").click();
  await downloading;
  assert.match(await page.evaluate(() => host.prepare().then(() => "unexpected", error => error.message)), /Stop the active/);
  await page.evaluate(() => host.stop());
  await page.waitForFunction(() => globalThis.failure);
  assert.equal(await page.evaluate(() => globalThis.failure), "Preparation stopped");
  release(); await context.unroute("https://huggingface.co/**", hold);
  const stopped = await page.evaluate(() => statuses.length);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => statuses.length), stopped);
  observations.checks.push("Double Start rejected; Stop during real download rejects preparation and prevents late ready");
  await page.reload(); await page.waitForFunction(() => globalThis.host);
  const modelRequests = [];
  page.on("request", (request) => { if (request.url().startsWith("https://")) modelRequests.push(request.url()); });
  const begin = performance.now();
  await page.locator("#prepare").click();
  await page.waitForFunction(() => globalThis.result || globalThis.failure, undefined, { timeout: 240000 });
  const first = await page.evaluate(() => ({ result: globalThis.result, failure: globalThis.failure, statuses }));
  observations.firstLoadMs = performance.now() - begin;
  observations.first = { result: first.result, failure: first.failure,
    states: [...new Set(first.statuses.map(status => status.state))], updates: first.statuses.length };
  observations.networkFailures = networkFailures;
  assert.equal(first.failure, undefined, JSON.stringify(observations));
  assert.equal(first.result.state, "ready");
  assert.equal(first.result.downloadedBytes, first.result.requiredBytes);
  const states = first.statuses.map(status => status.state);
  assert.ok(states.includes("downloading") && states.includes("cached") && states.includes("loading") && states.includes("ready"));
  observations.remotePaths = modelRequests.map(value => { const url = new URL(value); return url.origin + url.pathname; });
  assert.ok(modelRequests.every(url => url.startsWith(`https://huggingface.co/${initial.model.id}/resolve/${initial.model.version}/`)
    || url.startsWith(`https://huggingface.co/api/resolve-cache/models/${initial.model.id}/${initial.model.version}/`)
    || ["us.aws.cdn.hf.co", "cas-bridge.xethub.hf.co", "cas-server.xethub.hf.co"].includes(new URL(url).hostname)), "Only pinned Hub artifacts and their storage redirects are fetched");
  assert.equal(modelRequests.filter(url => url.startsWith(`https://huggingface.co/${initial.model.id}/resolve/`)).length, 7);
  observations.checks.push("Real pinned q8 WASM encoder/decoder pipeline load; bounded progress and ready distinct from cached");
  await page.evaluate(() => host.stop());
  assert.equal(await page.evaluate(() => host.status().then(status => status.state)), "cached");
  await context.setOffline(true);
  await page.evaluate(() => { globalThis.result = undefined; globalThis.failure = undefined; globalThis.statuses.length = 0; });
  await page.locator("#prepare").click();
  await page.waitForFunction(() => statuses.some(status => status.state === "loading"));
  await page.evaluate(() => host.stop());
  await page.waitForFunction(() => globalThis.failure);
  assert.equal(await page.evaluate(() => globalThis.failure), "Preparation stopped");
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => statuses.some(status => status.state === "ready")), false);
  observations.checks.push("Stop during actual cached pipeline loading prevents late ready");
  assert.equal(await page.evaluate(() => host.status().then(status => status.state)), "cached");
  const offlineBegin = performance.now();
  await page.evaluate(() => { globalThis.result = undefined; globalThis.failure = undefined; globalThis.statuses.length = 0; });
  const requestsBefore = modelRequests.length;
  await page.locator("#prepare").click();
  await page.waitForFunction(() => globalThis.result || globalThis.failure, undefined, { timeout: 120000 });
  const offline = await page.evaluate(() => ({ result: globalThis.result, failure: globalThis.failure, statuses }));
  assert.equal(offline.failure, undefined); assert.equal(offline.result.state, "ready");
  assert.equal(modelRequests.length, requestsBefore);
  assert.equal(offline.statuses.some(status => status.state === "downloading"), false);
  observations.offlineReloadMs = performance.now() - offlineBegin;
  observations.checks.push("Stop releases resident worker; cached model and locally bundled runtime reload offline without remote requests");
  await page.evaluate(async () => {
    host.stop();
    const name = (await caches.keys()).find(name => name.startsWith('interpreter-asr-'));
    const cache = await caches.open(name);
    const key = (await cache.keys()).find(request => request.url.endsWith('/tokenizer_config.json'));
    globalThis.restoreCache = { name, key: key.url, response: await cache.match(key) };
    await cache.put(key, new Response('x'.repeat(282683), {headers: {'Content-Length': '282683'}}));
    globalThis.result = undefined; globalThis.failure = undefined; globalThis.statuses.length = 0;
  });
  assert.equal(await page.evaluate(() => host.status().then(status => status.state)), "cached");
  await page.locator("#prepare").click();
  await page.waitForFunction(() => globalThis.failure, undefined, { timeout: 120000 });
  assert.equal(await page.evaluate(() => globalThis.failure), "model-load-failed");
  assert.equal(await page.evaluate(() => statuses.some(status => status.state === "ready")), false);
  await page.evaluate(async () => {
    host.stop(); const saved = globalThis.restoreCache;
    await (await caches.open(saved.name)).put(saved.key, saved.response);
    delete globalThis.restoreCache;
  });
  observations.checks.push("Same-size corrupt cached tokenizer cannot masquerade as a loaded model; failure stays explicit");
  await page.evaluate(() => { globalThis.result = undefined; globalThis.failure = undefined; });
  await page.locator("#prepare").click();
  await page.waitForFunction(() => globalThis.result || globalThis.failure, undefined, { timeout: 120000 });
  assert.equal(await page.evaluate(() => globalThis.result?.state), "ready");
  await context.setOffline(false);
  const other = await context.newPage(); await other.goto(`${origin}/host-test`); await other.bringToFront();
  await page.waitForFunction(() => document.visibilityState === "hidden", undefined, { polling: 100 });
  assert.match(await page.evaluate(() => host.status().then(() => "unexpected", error => error.message)), /visible secure document/);
  await page.bringToFront(); await page.waitForFunction(() => document.visibilityState === "visible");
  assert.equal(await page.evaluate(() => host.status().then(status => status.state)), "cached");
  await other.close();
  observations.checks.push("Hidden document stops resident inference and rejects operations; returning requires explicit Prepare");
  assert.equal(await page.evaluate(() => host.evict().then(status => status.state)), "evicted");
  assert.deepEqual(await page.evaluate(() => caches.keys().then(keys => keys.filter(key => key.startsWith("interpreter-asr-")))), []);
  observations.checks.push("Explicit eviction deletes only the candidate cache and releases residency");
  await page.evaluate(() => { host.dispose(); host.dispose(); });
  assert.match(await page.evaluate(() => host.status().then(() => "unexpected", error => error.message)), /visible secure document/);
  await page.goto(`${origin}/preparation.html`);
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'absent');
  assert.ok((await page.locator('#identity').textContent()).includes(initial.model.id));
  assert.ok((await page.locator('#identity').textContent()).includes(initial.model.version));
  assert.ok((await page.locator('#identity').textContent()).includes(String(initial.requiredBytes)));
  await page.getByRole('button', { name: 'Prepare model', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'downloading');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'stopped');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#status').getAttribute('data-state'), 'stopped');
  assert.equal(await page.getByRole('button', { name: 'Prepare model', exact: true }).isEnabled(), true);
  observations.checks.push("Packaged preparation UI shows exact identity/storage, live download state, and responsive Stop");
  assert.deepEqual(errors, []);
  observations.pageErrors = errors;
  await context.close();
  console.log(JSON.stringify({ passed: true, ...observations }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, ...observations, error: error.message }));
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
