import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const outDir = resolve(".ralph/captions-stability");
await build({ configFile: false, logLevel: "warn", build: { outDir,
  rollupOptions: { input: resolve("apps/chrome/overlay.ts"), preserveEntrySignatures: "strict", output: { entryFileNames: "overlay.js" } } } });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.clock.install();
  await page.setContent('<div></div>');
  const { readFile } = await import('node:fs/promises');
  const bundle = await readFile(`${outDir}/overlay.js`, 'utf8');
  const exportedName = bundle.match(/(\w+) as createVideoOverlay/)[1];
  await page.addScriptTag({ type: 'module', content: bundle.replace(/export\s*\{[^}]+\};?\s*$/, `globalThis.createVideoOverlay = ${exportedName};`) });
  await page.waitForFunction(() => globalThis.createVideoOverlay);
  await page.evaluate(() => {
    const identity = { sessionId: 'stability', targetId: 'tab', epoch: 0 };
    globalThis.overlay = createVideoOverlay(document, null, identity);
    globalThis.send = (id, revision, text, pending = false, speakerId, final = false) => overlay.compare({
      source: { identity, utteranceId: id, sourceRevision: revision, text: 'Corrected English source', final, speakerId, language: 'en', audioRange: {startMs: id === 'one' ? 0 : 1000, endMs: id === 'one' ? 1000 : 2000} },
      translation: pending ? {state:'pending'} : {state:'paired', revision:{identity,utteranceId:id,sourceRevision:revision,translationRevision:revision,languages:{source:'en',target:'ko'},text,final}} });
    globalThis.read = () => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span').textContent;
    send('one', 1, '첫 번째 문장');
  });
  assert.equal(await page.evaluate(() => read()), '첫 번째 문장');
  await page.evaluate(() => send('one', 2, '', true));
  await page.clock.runFor(180);
  assert.equal(await page.evaluate(() => read()), '첫 번째 문장', 'Keep translation visible while its corrected pair is pending');
  await page.evaluate(() => send('one', 2, '교정된 첫 문장'));
  await page.clock.runFor(180);
  assert.equal(await page.evaluate(() => read()), '교정된 첫 문장');
  await page.evaluate(() => send('two', 1, '두 번째 문장'));
  assert.equal(await page.evaluate(() => read()), '교정된 첫 문장', 'New utterances cannot discard unread captions');
  await page.clock.runFor(2500);
  assert.equal(await page.evaluate(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live').style.opacity), '1', 'Queued sentences must not fade the whole cue to blank');
  await page.clock.runFor(500);
  assert.equal(await page.evaluate(() => read()), '두 번째 문장');
  await page.evaluate(() => { overlay.clear(); send('one', 1, '첫 화자', false, 1, true); });
  const background = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span')).backgroundColor);
  const firstBackground = await background();
  await page.clock.runFor(3999);
  assert.equal(await page.evaluate(() => read()), '첫 화자', 'Completed captions need at least four seconds of reading time');
  await page.clock.runFor(1);
  assert.equal(await page.evaluate(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live').style.opacity), '0');
  await page.clock.runFor(250);
  assert.equal(await page.evaluate(() => read()), '');
  await page.evaluate(() => { overlay.clear(); send('two', 1, '둘째 화자', false, 2, true); });
  assert.notEqual(await background(), firstBackground, 'Different voices require different caption backgrounds');
  assert.equal(await page.evaluate(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-speaker')), null, 'Speaker numbers should not appear in captions');
  console.log(JSON.stringify({passed:true,pendingTranslationHeld:true,unreadSentencePreserved:true,speakerBackgrounds:true,finalHoldMs:4000,fadeMs:250}));
} finally { await browser.close(); }
