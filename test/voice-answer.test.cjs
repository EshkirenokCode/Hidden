const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateVoiceAnswer } = require('../electron/voice-answer.cjs');
const request = { model: 'gemini-3.5-flash-lite', context: '', conversation: '', question: 'Что такое Go?', style: 'brief' };
function untilAbort(signal) {
  return new Promise((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
  });
}
test('real Gemini streaming adapter survives a 12-second first-token delay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notices = [], deltas = []; let done = false;
  const pending = generateVoiceAnswer(request, 'fake-key', async (_url, options) => ({ ok: true, body: (async function* () {
    await sleep(12000, options.signal);
    yield new TextEncoder().encode('data: '+JSON.stringify({event_type:'step.delta',delta:{type:'text',text:'Go — язык программирования.'}})+'\n\n');
    yield new TextEncoder().encode('data: '+JSON.stringify({event_type:'interaction.completed',interaction:{status:'completed'}})+'\n\n');
  })() }), { onDelta: text => deltas.push(text), onNotice: text => notices.push(text) }).then(result => { done = true; return result; });
  // Allow fetch/stream setup before advancing virtual time.
  for(let i=0;i<8;i++) await Promise.resolve();
  t.mock.timers.tick(9000); await Promise.resolve();
  assert.equal(done,false); assert.equal(notices.length,1);
  t.mock.timers.tick(3001);
  const result=await pending;
  assert.equal(result.error,undefined);assert.match(result.answer,/Go/);assert.equal(deltas.length,1);
});
test('first-token timeout identifies the stage and preserves the question', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=generateVoiceAnswer(request,'key',null,{ generateImpl:async(_r,_k,_f,options)=>untilAbort(options.signal) });
  t.mock.timers.tick(30000);const result=await pending;
  assert.equal(result.timeoutStage,'first');assert.match(result.error,/не начал ответ за 30 с/);assert.equal(result.partialAnswer,'');
});
test('stalled stream returns the partial answer instead of deleting it', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=generateVoiceAnswer(request,'key',null,{ generateImpl:async(_r,_k,_f,options)=>{ options.onDelta('Часть ответа');return untilAbort(options.signal); } });
  t.mock.timers.tick(19999);await Promise.resolve();t.mock.timers.tick(1);
  const result=await pending;assert.equal(result.timeoutStage,'idle');assert.equal(result.partialAnswer,'Часть ответа');assert.match(result.error,/часть ответа сохранена/);
});
test('total deadline is independent of first-token and idle deadlines', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=generateVoiceAnswer(request,'key',null,{ limits:{totalMs:1000,idleMs:20000},generateImpl:async(_r,_k,_f,options)=>{options.onDelta('Начало');return untilAbort(options.signal);} });
  t.mock.timers.tick(1000);const result=await pending;assert.equal(result.timeoutStage,'total');assert.equal(result.partialAnswer,'Начало');
});
test('explicit cancellation is not relabeled as an API timeout', async()=>{
  const controller=new AbortController();
  const pending=generateVoiceAnswer(request,'key',null,{signal:controller.signal,generateImpl:async(_r,_k,_f,options)=>untilAbort(options.signal)});
  controller.abort(new DOMException('Stopped','AbortError'));await assert.rejects(pending,{name:'AbortError'});
});
