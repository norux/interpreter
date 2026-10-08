import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const output = resolve(".ralph/media-framework/chrome-composition-build");
await build({ configFile: "vite.chrome.config.ts", logLevel: "warn", build: { outDir: output,
  rollupOptions: { input: { composition: resolve("apps/chrome/composition.ts"), view: resolve("packages/presentation-web/comparison.ts"),
    policy: resolve("packages/core/presentation-policy.ts") }, preserveEntrySignatures: "strict", output: { entryFileNames: "[name].js" } },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><meta charset="utf-8"><title>Chrome composition contract fixture</title>
      <div id="app" style="width:700px"></div><div id="view" style="width:220px"></div>
      <script type="module">
      import {createChromeComposition} from '/composition.js';
      import {createComparisonView} from '/view.js';
      import {createPresentationPolicy} from '/policy.js';
      // Intentional model/native/input mocks: this test proves application wiring,
      // browser DOM/layout and controls. It performs no real ASR or translation.
      globalThis.workers = []; globalThis.nativeCreations = []; globalThis.translations = [];
      globalThis.deferPreparation = false; globalThis.loads = []; globalThis.destroyed = 0;
      globalThis.Worker = class {
        constructor(url) { this.url = String(url); this.terminated = false; workers.push(this); }
        terminate() { this.terminated = true; }
        postMessage(message) {
          const reply = data => { if (!this.terminated) this.onmessage?.({data: {version: 1, requestId: message.requestId, ...data}}); };
          this.messages ??= []; this.messages.push(message);
          if (message.type === 'prepare') {
            const ready = () => reply({type: 'ready'});
            if (deferPreparation) loads.push(ready); else setTimeout(ready, 0);
          } else if (message.type === 'recognize') setTimeout(() => reply({type: 'result', text: '<img src=x onerror=alert(1)> synthetic original', inferenceMs: 2}), 0);
          else {
            const probability = message.pcm.some(sample => Math.abs(sample) > 0.01) ? 1 : 0;
            setTimeout(() => reply({type: 'result', probability, inferenceMs: 1, samples: message.pcm.length, paddingSamples: 512-message.pcm.length}), 0);
          }
        }
      };
      Object.defineProperty(window, 'Translator', {configurable: true, value: {
        availability: async () => 'available',
        create(options) {
          nativeCreations.push({source: options.sourceLanguage, target: options.targetLanguage,
            active: navigator.userActivation.isActive, signal: options.signal});
          const native = {destroy() {destroyed++}, translate(text, {signal}) {
            return new Promise(resolve => translations.push({text, signal, resolve}));
          }};
          return deferPreparation ? new Promise(resolve => loads.push(() => resolve(native))) : Promise.resolve(native);
        }
      }});
      globalThis.opened = []; globalThis.closedInputs = 0;
      globalThis.input = {probe: async () => ({state:'available'}), async open(target, identity) {
        const state = {target, identity, closed:false}; opened.push(state);
        state.interrupt = type => {
          state.event = {identity, sequence:1, type, anchor:{clockId:'fixture-clock', monotonicMs:2660, mediaTimeMs:45000, playbackRate:1}};
          state.wake?.();
        };
        const close = async () => {if (!state.closed) {state.closed=true; closedInputs++; state.wake?.()}};
        return {close, events: {async *[Symbol.asyncIterator]() {
          yield {identity, sequence:0, type:'play', anchor:{clockId:'fixture-clock', monotonicMs:100, mediaTimeMs:12000, playbackRate:1}};
          for (let sequence=0; sequence<80 && !state.closed; sequence++) {
            await new Promise(resolve => setTimeout(resolve, 3));
            if (state.closed) return;
            if (state.event) {yield state.event;return}
            const pcm = new Float32Array(512).fill(sequence<30 ? 0.2 : 0);
            yield {identity, scope:'selected-video', sequence, sampleRate:16000, channels:1, sampleFormat:'pcm-f32le',
              audioRange:{startMs:sequence*32, endMs:(sequence+1)*32},
              capture:{clockId:'fixture-clock', startMs:100+sequence*32, endMs:100+(sequence+1)*32}, pcm:pcm.buffer};
          }
          if (!state.closed) await new Promise(resolve => {state.wake=resolve});
          if (!state.closed && state.event) yield state.event;
        }}};
      }};
      globalThis.app = createChromeComposition(document.querySelector('#app'), input);
      globalThis.select = (id='selected', language='ja') => app.select({id, documentId:'document', frameId:'top'}, language);
      globalThis.view = createComparisonView(document.querySelector('#view'));
      globalThis.identity = {sessionId:'view-fixture', targetId:'selected', epoch:0}; view.activate(identity);
      globalThis.now = 0; globalThis.timers = []; globalThis.progresses = []; globalThis.presentation = [];
      globalThis.policy = createPresentationPolicy(identity, {now:()=>now, schedule(callback, delay) {
        const timer={callback, at:now+delay}; timers.push(timer); return ()=>{timer.cancelled=true};
      }}, event => {presentation.push(event); view.present(event)});
      view.onDisplayProgress(progress => {progresses.push(progress); policy.progress(progress)});
      globalThis.caption = (index, text='합성 번역 '.repeat(80), revision=1) => ({source:{identity, utteranceId:'row-'+index, sourceRevision:revision, final:true,
        language:'ja', text:'<script>synthetic</scr'+'ipt>', audioRange:{startMs:index*1000, endMs:(index+1)*1000}},
        translation:{state:'paired', revision:{identity, utteranceId:'row-'+index, sourceRevision:revision, translationRevision:revision,
          languages:{source:'ja',target:'ko'}, text, final:true}}, videoRange:{startMs:10000+index*1000,endMs:11000+index*1000}});
      globalThis.advance = milliseconds => {
        now+=milliseconds; const ready=timers.filter(t=>!t.cancelled && t.at<=now);
        for(const timer of ready) {timer.cancelled=true;timer.callback()}
      };
      globalThis.ready = true;
      </script>`); return;
  }
  const file = resolve(output, `.${path}`);
  if (!file.startsWith(output + sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" })[extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
const observations = { scope: "B4 built composition with mocked workers/native translator/PCM input; actual browser DOM, layout and clicks. No real transcription, translation, audio acquisition or extension installation", checks: [], pageErrors: [] };
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  observations.browser = browser.version(); observations.platform = `${process.platform}/${process.arch}`;
  const page = await browser.newPage(); page.on("pageerror", error => observations.pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => ready);
  const prepare = page.getByRole("button", { name: "Prepare selected language", exact: true });
  const start = page.getByRole("button", { name: "Start interpretation", exact: true });
  const stop = page.getByRole("button", { name: "Stop interpretation", exact: true });
  assert.equal(await prepare.isDisabled(), true); assert.equal(await start.isDisabled(), true);
  await page.evaluate(() => select()); assert.equal(await prepare.isDisabled(), false);
  assert.equal(await page.evaluate(() => nativeCreations.length), 0);
  await prepare.click(); await page.waitForFunction(() => !document.querySelector('#app button:nth-child(2)').disabled);
  assert.deepEqual(await page.evaluate(() => nativeCreations.map(({source,target,active})=>({source,target,active}))), [{source:"ja", target:"ko", active:true}]);
  assert.deepEqual(await page.evaluate(() => workers.flatMap(worker=>worker.messages.filter(m=>m.type==='prepare' && m.candidate).map(m=>({candidate:m.candidate,device:m.device})))), [{candidate:"smallFp16",device:"webgpu"}]);
  await start.dblclick();
  await page.waitForFunction(() => translations.length === 1);
  assert.equal(await page.evaluate(() => opened.length), 1);
  const row = page.locator("#app tbody tr");
  await row.waitFor(); assert.equal(await row.getAttribute("data-translation-state"), "pending");
  assert.equal(await row.locator("td").nth(2).textContent(), "Translation pending");
  assert.match(await row.locator("td").nth(1).textContent(), /^12\.0–/);
  assert.match(await page.locator("#app .interpreter-live").textContent(), /synthetic original/);
  assert.equal(await page.locator("#app img").count(), 0);
  await page.evaluate(() => translations[0].resolve('합성 번역 결과'));
  await page.waitForFunction(() => document.querySelector('#app tbody tr').dataset.translationState === 'paired');
  assert.equal(await row.locator("td").nth(2).textContent(), "합성 번역 결과");
  assert.equal(await row.getAttribute("data-source-revision"), "1"); assert.equal(await row.getAttribute("data-translation-revision"), "1");
  observations.checks.push("Trusted preparation gesture, smallFp16/WebGPU default, one Start, original-first/pending DOM and exact paired revisions/video mapping/text safety");
  await stop.click(); await page.waitForFunction(() => closedInputs === 1);
  assert.equal(await row.count(), 1); assert.equal(await page.locator("#app .interpreter-live").textContent(), "");
  assert.ok(await page.evaluate(() => workers.every(worker=>worker.terminated)));
  await page.evaluate(() => select('selected-en', 'en')); await prepare.click();
  await page.waitForFunction(() => !document.querySelector('#app button:nth-child(2)').disabled);
  await start.click(); await page.waitForFunction(() => translations.length === 2);
  await page.evaluate(() => opened.at(-1).interrupt('seek'));
  await page.waitForFunction(() => closedInputs === 2);
  await page.evaluate(() => translations[1].resolve('late translation after seek'));
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#app tbody tr").count(), 2);
  assert.equal(await page.locator("#app tbody tr").last().getAttribute("data-translation-state"), "pending");
  assert.equal(await page.evaluate(() => translations[1].signal.aborted), true);
  assert.equal(await start.isDisabled(), true);
  assert.equal(await page.locator("#app .interpreter-live").textContent(), "");
  await stop.click();
  observations.checks.push("Stop releases input/workers and retains comparison history; English reprepare, seek epoch cancellation and late native output suppression");
  await page.evaluate(() => {deferPreparation=true}); await prepare.click(); await stop.click();
  await page.evaluate(() => {for(const load of loads) load()}); await page.waitForTimeout(100);
  assert.equal(await start.isDisabled(), true); assert.equal(await page.evaluate(() => opened.length), 2);
  assert.ok(await page.evaluate(() => nativeCreations.at(-1).signal.aborted));
  observations.checks.push("Stop during all-host preparation cannot restore readiness or start input");

  await page.evaluate(() => {
    const c=caption(0); view.compare(c); policy.accept({type:'paired-caption', caption:c});
  });
  const initial = await page.evaluate(() => ({text:document.querySelector('#view .interpreter-live span').textContent,
    progress:progresses.at(-1), full:caption(0).translation.revision.text}));
  assert.equal(initial.progress.visible, true); assert.equal(initial.progress.complete, false);
  assert.ok(initial.text.length > 0 && initial.text.length < initial.full.length);
  await page.evaluate(() => advance(6000));
  const next = await page.evaluate(() => ({text:document.querySelector('#view .interpreter-live span').textContent, progress:progresses.at(-1)}));
  assert.equal(next.progress.partIndex, 1); assert.equal(next.progress.visible, true);
  assert.equal(initial.text + next.text, initial.full.slice(0, initial.text.length+next.text.length), "Measured replay advances sequentially without omissions");
  await page.evaluate(() => {const c=caption(0, '새로운 최종 번역 '.repeat(80), 2); view.compare(c); policy.accept({type:'paired-caption',caption:c})});
  assert.equal(await page.evaluate(() => progresses.at(-1).partIndex), 0);
  await page.evaluate(() => {policy.clear();const c=caption(1, '짧은 최종 번역');policy.accept({type:'paired-caption',caption:c});advance(2500)});
  assert.equal(await page.evaluate(() => presentation.at(-1).type), "fade");
  assert.equal(await page.locator("#view .interpreter-live").evaluate(node => getComputedStyle(node).transitionDuration), "0.25s");
  await page.evaluate(() => advance(250)); assert.equal(await page.evaluate(() => presentation.at(-1).type), "remove");
  assert.equal(await page.locator("#view .interpreter-live span").first().textContent(), "");
  await page.evaluate(() => {for(let i=0;i<305;i++)view.compare(caption(i,`합성 ${i}`))});
  assert.equal(await page.locator("#view tbody tr").count(), 300);
  assert.equal(await page.locator("#view tbody tr").first().getAttribute("data-utterance-id"), "row-5");
  assert.equal(await page.locator("#view script").count(), 0);
  await page.evaluate(() => view.compare({...caption(999),source:{...caption(999).source,identity:{...identity,epoch:9}}}));
  assert.equal(await page.locator("#view tbody tr").last().getAttribute("data-utterance-id"), "row-304");
  observations.layout = { firstCharacters: initial.text.length, secondCharacters: next.text.length, fullCharacters: initial.full.length, historyRows: 300 };
  observations.checks.push("Measured two-line replay, final restart at beginning, 250ms fade, 300-row retention, safe text and stale-epoch rejection");
  await page.evaluate(() => {
    policy.clear();
    const original = { ...caption(400).source, text: '대기 원문', final: false };
    policy.accept({ type: 'transcript', revision: original });
    view.compare({ source: original, translation: { state: 'pending' } });
    advance(6000);
  });
  assert.equal(await page.locator("#view .interpreter-live span").first().textContent(), "대기 원문");
  await page.evaluate(() => {
    // The provisional translation was evicted; a later final must still be read.
    const next = caption(401, '다음 최종 자막');
    policy.accept({ type: 'paired-caption', caption: next }); view.compare(next);
    advance(1); advance(250);
  });
  assert.equal(await page.locator("#view .interpreter-live span").first().textContent(), "다음 최종 자막");
  assert.equal(await page.locator('#view tr[data-utterance-id="row-400"]').getAttribute("data-translation-state"), "pending");
  observations.checks.push("Source-only reading progress prevents an untranslated provisional from blocking later final captions; pending history stays truthful");

  const firstTranslation = await page.evaluate(() => {
    policy.clear();
    const original = { ...caption(402).source, text: '긴 원문 '.repeat(100), final: false };
    policy.accept({ type: 'transcript', revision: original }); advance(6000);
    const originalPart = progresses.at(-1).partIndex;
    const partial = caption(402, '첫 임시 번역');
    partial.source = original; partial.translation.revision.final = false;
    policy.accept({ type: 'paired-caption', caption: partial });
    return { originalPart, translatedPart: progresses.at(-1).partIndex,
      text: document.querySelector('#view .interpreter-live span').textContent };
  });
  assert.equal(firstTranslation.originalPart, 1);
  assert.equal(firstTranslation.translatedPart, 0);
  assert.equal(firstTranslation.text, "첫 임시 번역");
  const correctedOriginal = await page.evaluate(() => {
    policy.clear();
    const partial = caption(403, '긴 임시 번역 '.repeat(100));
    partial.source.final = false; partial.translation.revision.final = false;
    policy.accept({ type: 'paired-caption', caption: partial }); advance(6000);
    const translatedPart = progresses.at(-1).partIndex;
    policy.accept({ type: 'transcript', revision: { ...partial.source, sourceRevision: 2, text: '교정 원문' } });
    return { translatedPart, originalPart: progresses.at(-1).partIndex,
      text: document.querySelector('#view .interpreter-live span').textContent };
  });
  assert.equal(correctedOriginal.translatedPart, 1);
  assert.equal(correctedOriginal.originalPart, 0);
  assert.equal(correctedOriginal.text, "교정 원문");
  observations.checks.push("First translation and corrected pending source start at their own beginning after measured long-text paging");

  await page.evaluate(async () => {await app.dispose();policy.dispose();view.dispose()});
  assert.equal(await page.locator("#app section").count(), 0); assert.equal(await page.locator("#view section").count(), 0);
  assert.deepEqual(observations.pageErrors, []);
  console.log(JSON.stringify({ passed: true, ...observations }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, ...observations, error: error.message })); process.exitCode = 1;
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
