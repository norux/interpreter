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
    globalThis.read = () => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live span')?.textContent ?? '';
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
  assert.deepEqual(await page.evaluate(() => Array.from(document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelectorAll('.interpreter-live > span:not(.interpreter-measure)')).map(span => span.textContent)),
    ['교정된 첫 문장', '두 번째 문장'], 'A ready caption must appear below the previous caption immediately');
  assert.equal(await page.evaluate(() => {
    const rows = document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelectorAll('.interpreter-live');
    return rows[1].getBoundingClientRect().top >= rows[0].getBoundingClientRect().bottom
      && getComputedStyle(rows[1]).visibility === 'visible';
  }), true);
  assert.equal(await page.evaluate(() => read()), '교정된 첫 문장', 'New utterances cannot discard unread captions');
  await page.clock.runFor(2500);
  assert.equal(await page.evaluate(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelectorAll('.interpreter-live')[1]?.style.opacity ?? '1'), '1', 'Fading an older row must not fade the following caption');
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
  await page.evaluate(() => { overlay.clear(); send('one', 1, '앞 자막', false, 1, true); });
  await page.clock.runFor(1000);
  await page.evaluate(() => send('two', 1, '뒤 자막', false, 2, true));
  await page.clock.runFor(3000);
  await page.clock.runFor(250);
  assert.equal(await page.evaluate(() => read()), '뒤 자막');
  await page.clock.runFor(749);
  assert.equal(await page.evaluate(() => read()), '뒤 자막');
  await page.clock.runFor(1);
  assert.equal(await page.evaluate(() => document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelector('.interpreter-live').style.opacity), '0',
    'The second caption expires from when it first appeared, without another four-second wait');
  await page.clock.runFor(250);
  assert.equal(await page.evaluate(() => read()), '');
  await page.setViewportSize({width:320,height:520});
  await page.evaluate(() => { overlay.clear(); for (let i=0;i<12;i++) send(`burst-${i}`,1,`대화 ${i}`,false,i%2+1,true); });
  const observed = new Map(); const retired = new Set();
  for (let elapsed=0;elapsed<=12000;elapsed+=250) {
    const rows=await page.evaluate(() => Array.from(document.querySelector('[data-interpreter-overlay]').shadowRoot.querySelectorAll('.interpreter-live')).map(row => ({
      id:row.dataset.utteranceId,visible:getComputedStyle(row).visibility==='visible',top:row.getBoundingClientRect().top,
      bottom:row.getBoundingClientRect().bottom,text:row.querySelector('span').textContent,
    })));
    for (const row of rows.filter(row=>row.visible)) {
      assert.ok(row.top>=0 && row.bottom<=520,'Visible rows must fit the narrow viewport');
      assert.ok(!retired.has(row.id),'A retired toast must never reappear');
      if(!observed.has(row.id))observed.set(row.id,elapsed);
    }
    for(const[id,firstShown]of observed)if(!rows.some(row=>row.id===id)&&!retired.has(id)){
      assert.ok(elapsed-firstShown>=4250,'Clipped captions cannot spend their reading time before becoming visible');retired.add(id);
    }
    if(elapsed===0)assert.ok(rows.some(row=>!row.visible),'Overflow must queue in a bounded display area');
    if(elapsed===0)await page.screenshot({path:'.ralph/captions-stability/stack-narrow.png'});
    await page.clock.runFor(250);
  }
  assert.equal(observed.size,12,'Every queued caption must eventually become visible');
  assert.equal(retired.size,12,'Concurrent reading must clear this burst without a serial four-second wait per row');
  console.log(JSON.stringify({passed:true,readyCaptionStacked:true,concurrentReading:true,narrowBurst:12,pendingTranslationHeld:true,unreadSentencePreserved:true,speakerBackgrounds:true,finalHoldMs:4000,fadeMs:250}));
} finally { await browser.close(); }
