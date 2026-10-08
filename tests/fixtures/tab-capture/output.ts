// Observe actual browser output independently of the adapter's stream/graph.
const state = globalThis as typeof globalThis & {
  outputStream: MediaStream; outputContext: AudioContext; observer: AnalyserNode;
  outputReady: boolean; error?: string; measure(): number[];
};
(document.querySelector("#observe") as HTMLButtonElement).onclick = async () => {
  try {
    state.outputStream = await navigator.mediaDevices.getDisplayMedia({ video: true,
      audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints,
    });
    if (state.outputStream.getAudioTracks().length !== 1) throw new Error("Missing independent site-output audio");
    state.outputContext = new AudioContext(); state.observer = state.outputContext.createAnalyser(); state.observer.fftSize = 8192;
    state.outputContext.createMediaStreamSource(state.outputStream).connect(state.observer);
    await state.outputContext.resume(); state.outputReady = true;
  } catch (error) { state.error = String(error); }
};
state.measure = () => { const samples = new Float32Array(state.observer.fftSize); state.observer.getFloatTimeDomainData(samples); return Array.from(samples); };
window.addEventListener("pagehide", () => {
  for (const track of state.outputStream?.getTracks() ?? []) track.stop();
  void state.outputContext?.close();
});
