class GhostAudio extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.used = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      this.buffer[this.used++] = channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length;
      if (this.used === this.buffer.length) { this.port.postMessage(this.buffer); this.buffer = new Float32Array(2048); this.used = 0; }
    }
    return true;
  }
}
registerProcessor('ghost-audio', GhostAudio);
