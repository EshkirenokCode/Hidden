const {test}=require('node:test');const assert=require('node:assert/strict');
const { readStream, analyzeAudio, transcribeAudio, generateGemini, media } = require('../electron/gemini.cjs');
function stream(events) { const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));return(async function*(){for(let i=0;i<bytes.length;i+=7)yield bytes.slice(i,i+7)})(); }
test('SSE handles split unicode, excludes thoughts and requires completion',async()=>{
  const deltas=[];const events=[{event_type:'step.delta',delta:{type:'thought_summary',text:'private'}},{event_type:'step.delta',delta:{type:'text',text:'Привет'}},{event_type:'interaction.completed',interaction:{status:'completed'}}];
  assert.equal(await readStream(stream(events),t=>deltas.push(t)),'Привет');assert.deepEqual(deltas,['Привет']);
  await assert.rejects(readStream(stream(events.slice(0,2)),()=>{}),/оборвался/);
});
test('fallback transcription uses technical vocabulary and makes only a transcription call',async()=>{
  let calls=0;
  const result=await transcribeAudio({model:'gemini-3.5-flash-lite',vocabulary:['Golang','PostgreSQL'],audio:{data:'UklGRg==',mimeType:'audio/wav'}},'test',async(url,options)=>{
    calls++;const body=JSON.parse(options.body);
    assert.match(body.input[0].text,/Golang, PostgreSQL/);assert.equal(body.response_format,undefined);
    return{ok:true,json:async()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Расскажите об особенностях языка Go.'}]}]})};
  });
  assert.equal(calls,1);assert.match(result.transcript,/языка Go/);assert.ok(result.transcriptionMs>=0);
});
test('general technical answers can use knowledge outside the candidate resume',async()=>{
  await generateGemini({model:'gemini-3.5-flash-lite',context:'',question:'Расскажите о Go.',style:'brief'},'test',async(url,options)=>{
    const body=JSON.parse(options.body);assert.match(body.system_instruction,/отсутствие темы в резюме НЕ означает отсутствие ответа/);
    return{ok:true,json:async()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Go — язык программирования.'}]}]})};
  });
});
test('fallback audio deadline is reported as transcription rather than a generic timeout',async()=>{
  await assert.rejects(transcribeAudio({model:'gemini-3.5-flash-lite',vocabulary:[],audio:{data:'UklGRg==',mimeType:'audio/wav'}},'test',async()=>{throw new DOMException('Timed out','TimeoutError');}),/не распознал аудиофразу за 12 с/);
});
test('audio schema validates output and manual mode suppresses automatic answers',async()=>{
  const request={model:'gemini-3.5-flash-lite',context:'',conversation:'',autoAnswer:false,audio:{data:'UklGRg==',mimeType:'audio/wav'}};
  const result=await analyzeAudio(request,'test',async(url,options)=>{
    const body=JSON.parse(options.body);
    if(!body.response_format){assert.equal(body.input[1].type,'audio');return{ok:true,json:async()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Question?'}]}]})};}
    assert.equal(body.response_format.mime_type,'application/json');
    return{ok:true,json:async()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({transcript:'Question?',question:'Question?',answer:'Must be suppressed'})}]}]})};
  });assert.equal(result.answer,'');
  assert.throws(()=>media({data:'bad!',mimeType:'image/png'},'image'),/медиафайл/);
});

const screenRequest = {
  model: 'gemini-3.5-flash-lite', context: '', question: 'Что выведет код на снимке?', style: 'brief',
  image: { data: 'aW1hZ2U=', mimeType: 'image/png' }
};
const delta = text => ({ event_type: 'step.delta', delta: { type: 'text', text } });
const completed = { event_type: 'interaction.completed', interaction: { status: 'completed' } };
const waitForAbort = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('screen reasoning with no visible text switches to a faster model on the same image', async () => {
  const requests = [];
  const shown = [];
  const notices = [];
  const answer = await generateGemini(screenRequest, 'test', async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) {
      return { ok: true, body: (async function* () {
        yield* stream([{ event_type: 'step.delta', delta: { type: 'thought_summary', text: 'Working' } }]);
        await waitForAbort(options.signal);
      })() };
    }
    assert.equal(options.signal.aborted, false);
    return { ok: true, body: stream([delta('Результат: 42'), completed]) };
  }, { screenFirstTextMs: 20, onDelta: text => shown.push(text), onScreenFallback: model => notices.push(model) });
  assert.equal(answer, 'Результат: 42');
  assert.deepEqual(shown, ['Результат: 42']);
  assert.deepEqual(notices, ['gemini-3.5-flash-lite']);
  assert.deepEqual(requests.map(body => [body.model, body.generation_config.thinking_level]), [
    ['gemini-3.8-flash', 'medium'], ['gemini-3.5-flash-lite', 'low']
  ]);
  assert.deepEqual(requests[0].input, requests[1].input);
});

test('a screen answer that has started is allowed to finish after the initial deadline', async () => {
  let calls = 0;
  const answer = await generateGemini(screenRequest, 'test', async (_url, options) => {
    calls++;
    return { ok: true, body: (async function* () {
      yield* stream([delta('Пункт 1')]);
      await new Promise(resolve => setTimeout(resolve, 40));
      options.signal.throwIfAborted();
      yield* stream([delta(', пункт 2'), completed]);
    })() };
  }, { screenFirstTextMs: 20, onDelta: () => {} });
  assert.equal(calls, 1);
  assert.equal(answer, 'Пункт 1, пункт 2');
});

test('cancelling a screen request does not send it again', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = generateGemini(screenRequest, 'test', async (_url, options) => {
    calls++;
    controller.abort();
    await waitForAbort(options.signal);
  }, { signal: controller.signal, onDelta: () => {} });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});
