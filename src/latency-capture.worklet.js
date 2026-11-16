// Capture one selected input on the audio graph clock. Output stays silent.
class LatencyCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.frame = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data?.stop) this.stopped = true;
    };
  }
  process(inputs, outputs) {
    if (this.stopped) return false;
    outputs.forEach((output) => output.forEach((channel) => channel.fill(0)));
    if (this.used && currentFrame !== this.frame + this.used) this.used = 0;
    const input = inputs[0]?.[0];
    const length = outputs[0]?.[0]?.length ?? 128;
    for (let i = 0; i < length; i++) {
      if (!this.used) this.frame = currentFrame + i;
      this.buffer[this.used++] = input?.[i] ?? 0;
      if (this.used === this.buffer.length) {
        this.port.postMessage({ frame: this.frame, samples: this.buffer }, [
          this.buffer.buffer,
        ]);
        this.buffer = new Float32Array(2048);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("choirstar-latency-capture", LatencyCapture);
