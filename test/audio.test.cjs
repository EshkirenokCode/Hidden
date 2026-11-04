const { test } = require('node:test');
const assert = require('node:assert/strict');
test('WAV encoding preserves sample rate, clipping, lengths and PCM boundaries', async () => {
  const { encodeWav } = await import('../src/audio.mjs');
  const view = new DataView(encodeWav([new Float32Array([-2, 0, 2])], 16000));
  assert.equal(view.byteLength, 50); assert.equal(view.getUint32(24,true),16000); assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(48,true),32767);
});
test('speech segmentation ignores silence, flushes on pause and limits continuous audio', async () => {
  const { SpeechSegments } = await import('../src/audio.mjs'); const clips=[];
  const vad=new SpeechSegments(16000,b=>clips.push(b));
  for(let i=0;i<40;i++)vad.push(new Float32Array(1600));assert.equal(clips.length,0);
  for(let i=0;i<10;i++)vad.push(new Float32Array(1600).fill(.1));
  for(let i=0;i<10;i++)vad.push(new Float32Array(1600));assert.equal(clips.length,1);
  for(let i=0;i<160;i++)vad.push(new Float32Array(1600).fill(.1));assert.equal(clips.length,2);
});
