import type { AudioSource } from "./contracts";

export function createTabAudioSource(onEnded: () => void): AudioSource {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let stopped = false;

  return {
    async start(streamId, onFrame) {
      stopped = false;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
        } as MediaTrackConstraints,
        video: false,
      });
      if (stopped) {
        for (const track of stream.getTracks()) track.stop();
        stream = undefined;
        throw new Error("Capture was stopped during startup.");
      }
      for (const track of stream.getTracks()) track.addEventListener("ended", onEnded);
      context = new AudioContext();
      await context.audioWorklet.addModule(chrome.runtime.getURL("worklet.js"));
      if (stopped) throw new Error("Capture was stopped during startup.");
      source = context.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(context, "tab-pcm");
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onFrame(event.data);
      source.connect(context.destination);
      source.connect(worklet);
      // The worklet's silent output keeps processing active without playing the source twice.
      worklet.connect(context.destination);
      await context.resume();
    },
    async stop() {
      stopped = true;
      if (worklet) {
        worklet.port.onmessage = null;
        worklet.port.close();
        worklet.disconnect();
      }
      source?.disconnect();
      for (const track of stream?.getTracks() ?? []) {
        track.removeEventListener("ended", onEnded);
        track.stop();
      }
      if (context && context.state !== "closed") await context.close();
      stream = undefined;
      context = undefined;
      source = undefined;
      worklet = undefined;
    },
  };
}
