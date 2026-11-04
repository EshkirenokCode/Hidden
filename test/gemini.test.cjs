const {test}=require('node:test');const assert=require('node:assert/strict');
const { readStream, analyzeAudio, media } = require('../electron/gemini.cjs');
function stream(events) { const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));return(async function*(){for(let i=0;i<bytes.length;i+=7)yield bytes.slice(i,i+7)})(); }
test('SSE handles split unicode, excludes thoughts and requires completion',async()=>{
  const deltas=[];const events=[{event_type:'step.delta',delta:{type:'thought_summary',text:'private'}},{event_type:'step.delta',delta:{type:'text',text:'Привет'}},{event_type:'interaction.completed',interaction:{status:'completed'}}];
  assert.equal(await readStream(stream(events),t=>deltas.push(t)),'Привет');assert.deepEqual(deltas,['Привет']);
  await assert.rejects(readStream(stream(events.slice(0,2)),()=>{}),/оборвался/);
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
