import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioChunk, MediaTargetId, TranscriptRevision } from "../packages/contracts";
import { createSpeakerTracker } from "../packages/engines-browser/speaker-tracker";
import { createRevisionStore } from "../packages/core/revision-store";

const identity = { sessionId: "speakers", targetId: "tab" as MediaTargetId, epoch: 0 };
const source: TranscriptRevision = { identity, utteranceId: "one", sourceRevision: 1, text: "A spoken phrase", language: "en", final: false, audioRange: {startMs:0,endMs:3000} };
function chunk(startMs: number, amplitude = 0.05): AudioChunk {
  return {identity,scope:"tab-mix",sequence:startMs/1000,audioRange:{startMs,endMs:startMs+1000},capture:{clockId:"fixture",startMs,endMs:startMs+1000},sampleRate:16000,channels:1,sampleFormat:"pcm-f32le",pcm:new Float32Array(16000).fill(amplitude).buffer};
}

test("speaker labels arrive independently, reuse returning voices and cannot leak after Stop", async () => {
  const labels: { id: string; speakerId: number }[] = [];
  let embedding = new Float32Array([1,0]); let calls = 0;
  const tracker = createSpeakerTracker(async () => { calls++; return embedding; }, (id,speakerId)=>labels.push({id,speakerId}), error=>{throw error});
  tracker.observe(source);
  tracker.push(chunk(0)); await tracker.settle(); assert.deepEqual(labels,[]);
  tracker.push(chunk(1000)); await tracker.settle();
  assert.deepEqual(labels,[{id:"one",speakerId:1}]);
  tracker.observe({...source,sourceRevision:2}); assert.equal(labels.length,1);
  embedding = new Float32Array([0,1]);
  tracker.push(chunk(2000)); await tracker.settle();
  tracker.observe({...source,utteranceId:"two",audioRange:{startMs:1000,endMs:3000}});
  assert.deepEqual(labels.at(-1),{id:"two",speakerId:2});
  embedding = new Float32Array([1,0]);
  tracker.push(chunk(3000)); await tracker.settle();
  tracker.observe({...source,utteranceId:"three",audioRange:{startMs:2000,endMs:4000}});
  assert.deepEqual(labels.at(-1),{id:"three",speakerId:1});
  tracker.stop(); tracker.observe({...source,utteranceId:"late"}); tracker.push(chunk(4000)); await tracker.settle();
  assert.equal(calls,3); assert.equal(labels.length,3);
});

test("silence produces no voice ID and cancelling outstanding inference ignores its late result", async () => {
  const labels: number[] = []; const completion: {resolve?: (value:Float32Array)=>void} = {};
  const tracker = createSpeakerTracker(()=>new Promise(done=>{completion.resolve=done}), (_id,id)=>labels.push(id), error=>{throw error});
  tracker.observe(source); tracker.push(chunk(0,0)); await tracker.settle(); assert.equal(typeof completion.resolve,"undefined");
  tracker.push(chunk(1000)); tracker.push(chunk(2000)); const pending=tracker.settle(); tracker.stop(); completion.resolve?.(new Float32Array([1,0])); await pending;
  assert.deepEqual(labels,[]);
});

test("speaker metadata preserves exact translation pairing and rejects malformed or old-session labels", () => {
  const store=createRevisionStore(identity,300);
  store.accept({type:"transcript",revision:source});
  const translation={identity,utteranceId:"one",sourceRevision:1,translationRevision:1,languages:{source:"en",target:"ko"},text:"발화 내용",final:false};
  store.accept({type:"translation",revision:translation});
  const event={type:"speaker" as const,identity,utteranceId:"one",speakerId:1};
  const labelled=store.accept(event); assert.equal(labelled?.source.speakerId,1); assert.equal(labelled?.translation.state,"paired");
  assert.equal(store.accept({...event,speakerId:0}),undefined);
  assert.equal(store.accept({...event,identity:{...identity,epoch:1}}),undefined);
  const corrected=store.accept({type:"transcript",revision:{...source,sourceRevision:2}});
  assert.equal(corrected?.source.speakerId,1); assert.equal(corrected?.translation.state,"pending");
  assert.equal(store.accept({type:"translation",revision:translation}),undefined);
  const paired={source:{...source,sourceRevision:2,speakerId:1},translation:{state:"paired" as const,revision:{...translation,sourceRevision:2,translationRevision:2}}};
  store.accept({type:"paired-caption",caption:paired});
  store.activate({...identity,epoch:1});
  assert.equal(store.accept({type:"paired-caption",caption:{...paired,source:{...paired.source,speakerId:2}}}),undefined,
    "Old-epoch metadata cannot revive a paired caption");
});
