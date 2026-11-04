const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SystemAudio } = require('../electron/system-audio.cjs');
function child() {
  const proc = new EventEmitter(); proc.stdout = new EventEmitter();
  proc.stdout.setEncoding = () => {}; proc.stderr = { resume() {} };
  proc.kill = () => proc.emit('exit', 0); return proc;
}
test('native audio stops delivery immediately and treats deliberate stop as normal', async () => {
  const proc = child(), packets = [], errors = [];
  const capture = new SystemAudio('fake', x => packets.push(x), x => errors.push(x), () => proc);
  const started = capture.start();
  proc.stdout.emit('data', '{"type":"rea');
  proc.stdout.emit('data', 'dy"}\n'); await started;
  const pcm = '{"type":"pcm","sampleRate":16000,"data":"AAAAAA=="}\n';
  proc.stdout.emit('data', pcm); assert.equal(packets.length, 1);
  capture.stop(); proc.stdout.emit('data', pcm);
  assert.equal(packets.length, 1); assert.deepEqual(errors, []);
});
test('native audio reports unexpected process termination', async () => {
  const proc = child(), errors = [];
  const capture = new SystemAudio('fake', () => {}, x => errors.push(x), () => proc);
  const started = capture.start(); proc.stdout.emit('data', '{"type":"ready"}\n'); await started;
  proc.emit('exit', 1); assert.equal(errors.length, 1);
  assert.equal(capture.child, null);
});
