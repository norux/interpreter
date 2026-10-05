// Wire header: magic, rate, sequence, relative timestamp (ms), samples, version, channels.
export const PCM_HEADER_BYTES = 28;
export const PCM_SAMPLE_RATE = 24_000;
export const PCM_FRAME_SAMPLES = 480;

export function createPCMEncoder(inputRate: number, onFrame: (packet: ArrayBuffer) => void) {
  if (!Number.isFinite(inputRate) || inputRate <= 0) throw new Error("Invalid input sample rate");
  const ratio = inputRate / PCM_SAMPLE_RATE;
  let remaining = ratio;
  let sum = 0;
  let sequence = 0;
  let offset = 0;
  let packet = new ArrayBuffer(PCM_HEADER_BYTES + PCM_FRAME_SAMPLES * 2);
  let view = new DataView(packet);

  return (channels: Float32Array[]) => {
    if (!channels.length) return;
    for (let i = 0; i < channels[0].length; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i] / channels.length;
      let available = 1;
      // Area averaging keeps fractional resampling state across worklet quanta.
      while (available > 1e-9) {
        const weight = Math.min(remaining, available);
        sum += mono * weight;
        remaining -= weight;
        available -= weight;
        if (remaining < 1e-9) {
          const sample = Math.max(-1, Math.min(1, sum / ratio));
          view.setInt16(PCM_HEADER_BYTES + offset * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
          offset++;
          sum = 0;
          remaining = ratio;
          if (offset === PCM_FRAME_SAMPLES) {
            view.setUint32(0, 0x314d4350, true); // PCM1
            view.setUint32(4, PCM_SAMPLE_RATE, true);
            view.setUint32(8, sequence, true);
            view.setFloat64(12, sequence * 20, true);
            view.setUint32(20, PCM_FRAME_SAMPLES, true);
            view.setUint16(24, 1, true);
            view.setUint16(26, 1, true);
            onFrame(packet);
            sequence++;
            offset = 0;
            packet = new ArrayBuffer(PCM_HEADER_BYTES + PCM_FRAME_SAMPLES * 2);
            view = new DataView(packet);
          }
        }
      }
    }
  };
}
