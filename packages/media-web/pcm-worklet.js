// Fixed-size mono batches; the output remains silent to avoid doubling playback.
class SelectedVideoPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.offset = 0;
    this.frame = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      if (this.offset === 0) this.frame = currentFrame + i;
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.samples[this.offset++] = sample;
      if (this.offset === this.samples.length) {
        const pcm = this.samples.buffer;
        this.port.postMessage({ frame: this.frame, pcm }, [pcm]);
        this.samples = new Float32Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("selected-video-pcm", SelectedVideoPCM);
