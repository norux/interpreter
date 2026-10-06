// Real extension messaging/window with generated offscreen captions, without audio/models.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";

const profile = await mkdtemp(`${tmpdir()}/interpreter-transcript-`);
const extension = resolve("extension/dist");
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const offscreen = await context.newPage();
  await offscreen.goto(`${origin}/offscreen.html`);
  const tabId = await offscreen.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async (tabId) => {
    await chrome.storage.session.set({ captureStatus: { state: "capturing", tabId, sessionId: "generated-runtime", message: "Generated capture status" } });
  }, tabId);
  const created = context.waitForEvent("page");
  await worker.evaluate(async () => chrome.windows.create({ url: chrome.runtime.getURL("transcript.html"), type: "popup", width: 1100, height: 720 }));
  const view = await created;
  await view.waitForURL(`${origin}/transcript.html`);
  await view.locator('#status[data-state="capturing"]').waitFor();
  const caption = { sessionId: "generated-runtime", utteranceId: "u1", revision: 1, source: "駅で午後三時に会いましょう。", translation: "역에서 오후 3시에 만나요.", final: true, audioStartMs: 2000, audioEndMs: 4000, emittedAtMs: 1 };
  const emit = (message) => offscreen.evaluate(async (message) => { await chrome.runtime.sendMessage({ target: "worker", ...message }).catch(() => {}); }, message);
  await emit({ type: "caption", caption });
  await view.locator('#sentences tr[data-final="true"]').waitFor();
  assert.equal(await view.locator(".source").textContent(), caption.source);
  assert.equal(await view.locator(".translation").textContent(), caption.translation);
  assert.match(await view.locator(".time").textContent(), /00:02\.000— 00:04\.000/);
  await emit({ type: "caption", caption: { ...caption, revision: 2, source: "駅で午後四時に会いましょう。", translation: "역에서 오후 4시에 만나요." } });
  await view.waitForFunction(() => document.querySelector(".translation").textContent.includes("4시"));
  assert.equal(await view.locator("#sentences tr").count(), 1);
  await emit({ type: "caption", caption: { ...caption, sessionId: "old", revision: 3, translation: "오래된 세션" } });
  await emit({ type: "caption", caption: { ...caption, revision: 1, translation: "오래된 교정" } });
  const replay = await view.evaluate(() => chrome.runtime.sendMessage({ target: "worker", type: "transcript-snapshot" }));
  assert.equal(replay.captions.length, 1);
  assert.equal(replay.captions[0].translation, "역에서 오후 4시에 만나요.");
  await view.reload();
  await view.locator("#sentences tr").waitFor();
  assert.equal(await view.locator(".source").textContent(), "駅で午後四時に会いましょう。", "Reopening the view restores the latest recognized source");
  await emit({ type: "capture-status", status: { state: "idle", message: "Generated stop" } });
  await view.locator('#status[data-state="idle"]').waitFor();
  assert.equal(await view.locator("#sentences tr").count(), 1);
  await view.close();
  assert.equal((await worker.evaluate(() => chrome.storage.session.get("captureStatus"))).captureStatus.state, "idle");
  await writeFile("docs/verification/transcript/runtime.json", `${JSON.stringify({ browser: context.browser().version(), realExtensionMessaging: true, realComparisonWindow: true, generatedOffscreenCaptions: true, realCapture: false, sourceAndTranslation: true, audioTime: true, sameRow: true, staleRejection: true, replay: true, stopRetention: true }, null, 2)}\n`);
  console.log("Transcript runtime checks passed");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
