export function encodeWav(chunks, sampleRate) {
  const length = chunks.reduce((sum, x) => sum + x.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { const n = Math.max(-1, Math.min(1, sample)); view.setInt16(offset, n < 0 ? n * 32768 : n * 32767, true); offset += 2; }
  return buffer;
}
export class SpeechSegments {
  constructor(sampleRate, onSegment, { silenceMs = 650 } = {}) { this.rate = sampleRate; this.onSegment = onSegment; this.silenceMs = silenceMs; this.noise = 0.001; this.threshold = 0.008; this.reset(); this.pre = []; this.preSamples = 0; }
  reset() { this.chunks = []; this.samples = 0; this.silent = 0; this.voiced = 0; }
  push(frame) {
    const rms = Math.sqrt(frame.reduce((s, n) => s + n * n, 0) / frame.length);
    this.threshold = Math.max(0.006, Math.min(0.025, this.noise * 3));
    const speech = rms > this.threshold;
    if (!speech) this.noise = this.noise * 0.98 + rms * 0.02;
    if (!this.chunks.length && !speech) { this.pre.push(frame); this.preSamples += frame.length; while (this.preSamples > this.rate * 0.3 && this.pre.length > 1) this.preSamples -= this.pre.shift().length; return rms; }
    if (!this.chunks.length) { this.chunks.push(...this.pre); this.samples = this.preSamples; this.pre = []; this.preSamples = 0; }
    this.chunks.push(frame); this.samples += frame.length;
    if (speech) { this.silent = 0; this.voiced += frame.length; } else this.silent += frame.length;
    if (this.silent >= this.rate * this.silenceMs / 1000 || this.samples >= this.rate * 12) this.flush();
    return rms;
  }
  flush() {
    const emitted = this.voiced >= this.rate * 0.25;
    if (emitted) this.onSegment(encodeWav(this.chunks, this.rate));
    this.reset();
    return emitted;
  }
}
