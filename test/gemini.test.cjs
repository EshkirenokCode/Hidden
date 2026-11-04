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
