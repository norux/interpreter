// Real pinned speaker model over the same two-voice WAV, in a browser worker.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";
const outDir = resolve('.ralph/speaker-conversation');
await build({configFile:false,logLevel:'warn',worker:{format:'es'},build:{outDir,
  rollupOptions:{input:{speaker:resolve('packages/engines-browser/speaker-host.ts'),tracker:resolve('packages/engines-browser/speaker-tracker.ts')},preserveEntrySignatures:'strict',output:{entryFileNames:'[name].js'}}}});
const server = createServer(async(request,response)=>{
  try {
    const path = new URL(request.url,'http://localhost').pathname;
    const file = path==='/conversation.wav' || path==='/manifest.json' ? resolve('tests/fixtures/conversation',path.slice(1)) : resolve(outDir,path.slice(1));
    if(path==='/'){response.setHeader('Content-Type','text/html');response.end('<button>Prepare speakers</button>');return;}
    response.setHeader('Content-Type', {'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.wav':'audio/wav','.json':'application/json'}[extname(file)]??'application/octet-stream');
    response.end(await readFile(file));
  }catch(error){response.writeHead(404);response.end(String(error));}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chromium',headless:true});
try {
  const page=await browser.newPage();page.on('console',message=>{if(message.type()==='error')console.error(message.text())});page.on('pageerror',error=>console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const evidence=await page.evaluate(async()=>{
    const {createSpeakerHost}=await import('/speaker.js');const {createSpeakerTracker}=await import('/tracker.js');
    const statuses=[];const host=createSpeakerHost(document,status=>statuses.push(status));await host.prepare();
    const context=new AudioContext({sampleRate:16000});
    const buffer=await context.decodeAudioData(await(await fetch('/conversation.wav')).arrayBuffer());
    const manifest=await(await fetch('/manifest.json')).json();const pcm=buffer.getChannelData(0);
    const embeddings=[];
    for(const turn of manifest.turns){const start=Math.round((turn.startSeconds+0.3)*16000);const at=performance.now();
      const embedding=await host.embed(pcm.slice(start,start+32000));embeddings.push({speaker:turn.speaker,embedding:Array.from(embedding),inferenceMs:performance.now()-at});}
    const labels=[];let failure;
    const tracker=createSpeakerTracker(samples=>host.embed(samples),(id,speakerId)=>labels.push({id,speakerId}),error=>{failure=String(error)});
    const identity={sessionId:'fixture',targetId:'tab',epoch:0};
    // Exercise actual stream windows without waiting 58 seconds for transport.
    let turnIndex=0;
    for(let offset=0;offset<pcm.length;offset+=512){const samples=pcm.slice(offset,offset+512);const endMs=(offset+samples.length)/16;
      tracker.push({identity,scope:'tab-mix',sequence:offset/512,audioRange:{startMs:offset/16,endMs},capture:{clockId:'fixture',startMs:offset/16,endMs},sampleRate:16000,channels:1,sampleFormat:'pcm-f32le',pcm:samples.buffer});
      if((offset+samples.length)%16000<512)await tracker.settle();
      while(turnIndex<manifest.turns.length&&endMs>=(manifest.turns[turnIndex].startSeconds+3)*1000){
        const turn=manifest.turns[turnIndex];tracker.observe({identity,utteranceId:String(turnIndex),sourceRevision:1,language:'en',text:turn.text,final:false,audioRange:{startMs:turn.startSeconds*1000,endMs}});turnIndex++;
      }
    }
    await tracker.settle();tracker.stop();host.dispose();await context.close();
    return {statuses,embeddings,labels,failure};
  });
  await mkdir('.ralph/caption-conversation',{recursive:true});
  await writeFile('.ralph/caption-conversation/speaker-model.json',JSON.stringify(evidence,null,2));
  assert.equal(evidence.failure,undefined);
  const ids=evidence.labels.sort((a,b)=>Number(a.id)-Number(b.id)).map(x=>x.speakerId);
  assert.equal(ids.length,8);assert.notEqual(ids[0],ids[1]);
  for(let i=0;i<8;i++)assert.equal(ids[i],ids[i%2],`Turn ${i} must retain the same voice ID`);
  console.log(JSON.stringify({passed:true,labels:ids,inferenceMs:evidence.embeddings.map(x=>x.inferenceMs),report:'.ralph/caption-conversation/speaker-model.json'}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
