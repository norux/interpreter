// V1 real DOM/catalog acceptance, followed by V2 audio, V3 timeline, V4 access and V5 speech/isolation acceptance.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/video-catalog-build");
await build({ configFile: false, logLevel: "warn", build: {
  outDir: output, emptyOutDir: true, minify: false,
  rollupOptions: {
    input: { catalog: resolve("packages/media-web/catalog.ts"), selection: resolve("packages/media-web/selection.ts") },
    preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" },
  },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/frame.html") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<video title="Frame video" style="width:160px;height:90px"></video>
      <script type="module">import {createMediaCatalog} from '/catalog.js';
      globalThis.catalog = createMediaCatalog(document, location.hostname === 'localhost' ? 'other-origin-frame' : 'same-origin-frame');</script>`);
  } else if (path === "/catalog.js" || path === "/selection.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(await readFile(resolve(output, path.slice(1))));
  } else if (path === "/" || path === "/spa") {
    response.setHeader("Content-Type", "text/html");
    const fixture = await readFile("tests/fixtures/video-selection.html", "utf8");
    response.end(fixture.replace("http://localhost:1/", `http://localhost:${server.address().port}/`));
  } else { response.writeHead(404); response.end(); }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => globalThis.fixtureReady);
  const discover = () => page.evaluate(() => globalThis.catalog.discover());
  const current = (target) => page.evaluate((target) => globalThis.catalog.isCurrent(target), target);
  const choose = async (candidate) => {
    await page.locator("select").selectOption(candidate.target.id);
    await page.getByRole("button", { name: "Use selected video" }).click();
  };
  const initial = await discover();
  assert.equal(initial.length, 3, "A catalog lists only its document, never iframe videos");
  assert.deepEqual(initial.map((candidate) => candidate.visible), [true, true, false]);
  assert.equal(initial[0].width, 320);
  assert.equal(initial[0].height, 180);
  assert.deepEqual(await discover(), initial, "Repeated discovery preserves stable opaque handles");
  assert.deepEqual(Object.keys(initial[0].target).sort(), ["documentId", "frameId", "id"]);
  assert.equal(JSON.stringify(initial).includes(".mp4"), false, "Resource URLs stay local");
  assert.equal(await page.evaluate(() => globalThis.selections.length), 0, "A suggestion never confirms itself");
  await choose(initial[0]);
  assert.deepEqual(await page.evaluate(() => globalThis.selections), [initial[0].target]);

  // Actual playing canvas video (no audio) exercises playback metadata without fake media properties.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.getContext("2d").fillRect(0, 0, 50, 50);
    globalThis.fixtureStream = canvas.captureStream(10);
    const other = document.querySelector("#other");
    other.srcObject = globalThis.fixtureStream;
    await other.play();
    const ad = document.createElement("video");
    ad.id = "ad";
    ad.title = "Advertisement";
    ad.srcObject = globalThis.fixtureStream;
    document.body.prepend(ad);
    await ad.play();
  });
  await page.waitForFunction(() => document.querySelectorAll("select option").length === 5);
  const withAd = await discover();
  assert.equal(withAd.find((candidate) => candidate.label === "Advertisement").playing, true);
  assert.equal(withAd.find((candidate) => candidate.label === "Other video").playing, true);
  assert.equal(await current(initial[0].target), true);
  assert.deepEqual(await page.evaluate(() => globalThis.selections), [initial[0].target], "Ads/playback never switch the confirmed target");
  assert.equal(await page.locator("select").inputValue(), initial[0].target.id);

  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    await frame.waitForFunction(() => globalThis.catalog);
    const candidates = await frame.evaluate(() => globalThis.catalog.discover());
    assert.equal(candidates.length, 1);
    assert.notEqual(candidates[0].target.documentId, initial[0].target.documentId);
    assert.notEqual(candidates[0].target.frameId, initial[0].target.frameId);
    assert.equal(await current(candidates[0].target), false);
    assert.equal(await frame.evaluate((target) => globalThis.catalog.isCurrent(target), initial[0].target), false);
  }
  assert.equal(await page.evaluate(() => {
    try { return document.querySelectorAll("iframe")[1].contentWindow.document !== undefined; }
    catch { return false; }
  }), false, "Parent cannot access cross-origin frame DOM; separate permitted owners are required");
  for (const forged of [
    { ...initial[0].target, frameId: "wrong-frame" },
    { ...initial[0].target, documentId: "wrong-document" },
    { ...initial[0].target, id: "unknown-video" },
  ]) assert.equal(await current(forged), false);

  await page.evaluate(() => { document.querySelector("#main").src = "/ad.mp4"; });
  assert.equal(await current(initial[0].target), false, "Same element resource replacement retires its target");
  await page.getByRole("status").filter({ hasText: "changed or disappeared" }).waitFor();
  assert.deepEqual(await page.evaluate(() => globalThis.selections), [initial[0].target, null]);
  assert.equal(await page.locator("select").inputValue(), "");
  assert.equal(await page.getByRole("button").isDisabled(), true);
  const replacement = (await discover()).find((candidate) => candidate.label === "Main video");
  assert.notEqual(replacement.target.id, initial[0].target.id);
  await choose(replacement);
  assert.equal(await page.evaluate((target) => {
    const video = document.querySelector("#main");
    video.remove(); document.body.prepend(video);
    return globalThis.catalog.isCurrent(target);
  }, replacement.target), false, "Same-task resolution must reject a detached/reinserted element before observer delivery");
  await page.waitForFunction(() => globalThis.selections.at(-1) === null);
  assert.equal(await current(replacement.target), false, "Detach/reinsert cannot revive a retired handle");

  const beforeNavigation = (await discover())[0];
  await choose(beforeNavigation);
  await page.evaluate(() => history.pushState({}, "", "/spa"));
  assert.equal(await current(beforeNavigation.target), false, "SPA path changes invalidate document handles even before the polling tick");
  await page.waitForFunction(() => globalThis.selections.at(-1) === null);
  const afterNavigation = await discover();
  assert.notEqual(afterNavigation[0].target.documentId, beforeNavigation.target.documentId);
  assert.equal(await page.locator("select").inputValue(), "");
  const beforeSourceReload = (await discover()).find((candidate) => candidate.label === "Main video");
  await choose(beforeSourceReload);
  await page.evaluate(() => {
    const video = document.querySelector("#main");
    video.removeAttribute("src");
    const source = document.createElement("source");
    source.src = "/replacement.mp4";
    video.append(source);
  });
  await page.waitForFunction(() => globalThis.selections.at(-1) === null);
  const sourceTarget = (await discover()).find((candidate) => candidate.label === "Main video");
  await choose(sourceTarget);
  await page.evaluate(() => {
    const video = document.querySelector("#main");
    const source = video.querySelector("source");
    source.remove(); video.append(source);
  });
  await page.waitForFunction(() => globalThis.selections.at(-1) === null, undefined, { timeout: 2000 });
  assert.equal(await current(sourceTarget.target), false, "Source child reload retires a target even when the final URL is unchanged");
  const sameUrlTarget = (await discover())[0];
  await choose(sameUrlTarget);
  await page.evaluate(() => globalThis.catalog.invalidateDocument());
  await page.waitForFunction(() => globalThis.selections.at(-1) === null);
  assert.equal(await current(sameUrlTarget.target), false, "Host same-URL router invalidation retires the document");

  await page.evaluate(() => { document.querySelector("#main").setAttribute("aria-label", "<img src=x onerror=alert(1)>"); });
  await page.evaluate(() => globalThis.selection.refresh());
  assert.equal(await page.locator("#controls img").count(), 0, "Candidate labels are safe text");
  assert.ok((await page.locator("select").textContent()).includes("<img src=x onerror=alert(1)>"));
  const beforeDispose = (await discover())[0];
  await choose(beforeDispose);
  await page.evaluate(() => globalThis.catalog.dispose());
  await page.waitForFunction(() => globalThis.selections.at(-1) === null);
  assert.equal(await current(beforeDispose.target), false);
  assert.deepEqual(await discover(), []);
  await page.evaluate(() => {
    globalThis.selection.dispose(); globalThis.selection.dispose(); globalThis.catalog.dispose();
    for (const track of globalThis.fixtureStream.getTracks()) track.stop();
  });
  assert.equal(await page.locator("#controls section").count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, scope: "V1 catalog and selection only", browser: browser.version(),
    topDocumentVideos: 3, permittedFrameOwners: 2, stableIdentity: true, explicitConfirmation: true,
    adDoesNotRetarget: true, sourceReplacement: true, sourceChildReload: true, detachReinsert: true, spaNavigation: true,
    frameIsolation: true, safeLabels: true, idempotentCleanup: true, pageErrors: errors,
    realSelectedVideoPCM: false, originalAudibility: "unverified", asrAccuracy: "unverified",
    remainingAcceptance: ["V2 Web Audio/playback", "V3 PCM timeline", "V4 media access", "V5 speech/two-audible-video fixtures"] }));
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}

await import("./framework-video-audio.mjs");
