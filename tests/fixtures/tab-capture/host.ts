import type { AudioChunk } from "../../../packages/contracts";
import { createChromeTabInput } from "../../../apps/chrome/tab-input";

const state = globalThis as typeof globalThis & {
  interruptions: string[]; capture: ReturnType<typeof createChromeTabInput>; chunks: AudioChunk[];
  round: number; captureClosed: boolean; error?: string; captured: boolean; slowReady: boolean;
  handle: Awaited<ReturnType<ReturnType<typeof createChromeTabInput>["input"]["open"]>>;
  begin(slow?: boolean): Promise<void>; outputStream: MediaStream; outputContext: AudioContext;
  observer: AnalyserNode; outputReady: boolean; measure(): number[];
};
state.interruptions = [];
const capture = createChromeTabInput(Number(new URLSearchParams(location.search).get("tab")), chrome.runtime.getURL("pcm-worklet.js"),
  { maxChunkBytes: 8192, maxAudioQueueMs: 200 }, reason => state.interruptions.push(reason));
state.capture = capture;
state.chunks = [];
state.round = 0;
state.begin = async (slow = false) => {
  state.chunks = []; state.captureClosed = false; state.error = undefined;
  try {
    state.handle = await capture.input.open(capture.target, { sessionId: `round-${++state.round}`, targetId: capture.target.id, epoch: 0 });
    if (slow) { state.slowReady = true; return; }
    for await (const chunk of state.handle.events) {
      if ("type" in chunk) throw new Error("Tab capture must not emit video playback events");
      state.chunks.push(chunk);
      if (state.chunks.length > 100) state.chunks.shift();
    }
    state.captureClosed = true;
  } catch (error) { state.error = String(error); }
};
(document.querySelector("#start") as HTMLButtonElement).onclick = () => { void state.begin(); };
(document.querySelector("#slow") as HTMLButtonElement).onclick = () => { void state.begin(true); };
(document.querySelector("#stop") as HTMLButtonElement).onclick = () => { void capture.stop(); };
(document.querySelector("#restart") as HTMLButtonElement).onclick = () => {
  state.captured = false; void capture.capture().then(() => { state.captured = true; }).catch(error => { state.error = String(error); });
};
(document.querySelector("#observe") as HTMLButtonElement).onclick = async () => {
  try {
    state.outputStream = await navigator.mediaDevices.getDisplayMedia({ video: true,
      audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints, preferCurrentTab: true } as DisplayMediaStreamOptions);
    state.outputContext = new AudioContext(); state.observer = state.outputContext.createAnalyser(); state.observer.fftSize = 8192;
    state.outputContext.createMediaStreamSource(state.outputStream).connect(state.observer); await state.outputContext.resume(); state.outputReady = true;
  } catch (error) { state.error = String(error); }
};
state.measure = () => { const samples = new Float32Array(state.observer.fftSize); state.observer.getFloatTimeDomainData(samples); return Array.from(samples); };
void capture.capture().then(() => { state.captured = true; }).catch(error => { state.error = String(error); });
