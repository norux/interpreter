import { createPCMEncoder } from "./capture/pcm";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class TabPCMProcessor extends AudioWorkletProcessor {
  private readonly encode = createPCMEncoder(sampleRate, (packet) => {
    this.port.postMessage(packet, [packet]);
  });

  process(inputs: Float32Array[][]): boolean {
    this.encode(inputs[0] ?? []);
    return true;
  }
}

registerProcessor("tab-pcm", TabPCMProcessor);
