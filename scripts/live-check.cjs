// Explicitly opt-in: uses the supplied Gemini key and consumes API quota.
const fs = require('node:fs');
const { generate } = require('../electron/provider.cjs');
const { analyzeAudio } = require('../electron/gemini.cjs');
const key = process.env.GEMINI_API_KEY || (process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8').trim() : '');
if (!key) throw Error('Provide GEMINI_API_KEY or a path to a temporary key file.');
const results = [];
const cfg = { provider: 'gemini', model: 'gemini-3.5-flash-lite', question: 'Что такое индекс базы данных? Дай короткий ответ на русском.', context: 'Кандидат: backend-разработчик PostgreSQL. Не придумывай опыт.', style: 'brief' };
async function check(name, task) {
  const start = performance.now();
  try { const result = await task(start); const row = { name, ok: true, elapsedMs: Math.round(performance.now()-start), ...result }; results.push(row); console.log(JSON.stringify(row)); }
  catch(error) { const row = { name, ok: false, elapsedMs: Math.round(performance.now()-start), error: error.message.replaceAll(key,'[REDACTED]') }; results.push(row); console.log(JSON.stringify(row)); }
}
(async()=>{
  for (const model of (process.argv.includes('--fast') ? ['gemini-3.5-flash-lite'] : ['gemini-3.5-flash-lite','gemini-3.8-flash'])) await check('stream-text-'+model,async start=>{
    let firstTokenMs=null, streamed='';
    const answer = await generate({...cfg,model},key,fetch,{onDelta:text=>{firstTokenMs??=Math.round(performance.now()-start);streamed+=text;}});
    if(!answer || answer!==streamed.trim())throw Error('Streaming output mismatch');
    return { model, firstTokenMs, answer };
  });
  await check('screen-task',async()=>{
    const answer=await generate({...cfg,question:'Read the task in the image. Return only the numerical answer.',image:{data:fs.readFileSync('artifacts/task.png').toString('base64'),mimeType:'image/png'}},key);
    if(!answer.includes('4'))throw Error('Image answer did not contain 4');return{answer};
  });
  const audio={data:fs.readFileSync('artifacts/question.wav').toString('base64'),mimeType:'audio/wav'};
  await check('audio-question-auto-answer',async()=>{
    const result=await analyzeAudio({model:cfg.model,context:cfg.context,conversation:'',autoAnswer:true,audio},key);
    if(!/database index/i.test(result.transcript) || !/index/i.test(result.question) || !result.answer)throw Error('Audio recognition mismatch: '+result.transcript);return result;
  });
  await check('audio-manual-mode',async()=>{
    const result=await analyzeAudio({model:cfg.model,context:'',conversation:'',autoAnswer:false,audio},key);
    if(!/database index/i.test(result.transcript) || result.answer)throw Error('Manual audio recognition mismatch: '+result.transcript);return result;
  });
  const {encodeWav}=await import('../src/audio.mjs');
  await check('audio-silence',async()=>{
    const result=await analyzeAudio({model:cfg.model,context:'',conversation:'',autoAnswer:true,audio:{data:Buffer.from(encodeWav([new Float32Array(16000)],16000)).toString('base64'),mimeType:'audio/wav'}},key);
    if(result.question || result.answer)throw Error('Question hallucinated on silence');return result;
  });
  await check('audio-statement-without-question',async()=>{
    const result=await analyzeAudio({model:cfg.model,context:'',conversation:'',autoAnswer:true,audio:{data:fs.readFileSync('artifacts/statement.wav').toString('base64'),mimeType:'audio/wav'}},key);
    if(!result.transcript || result.question || result.answer)throw Error('Non-question was treated as a question: '+result.transcript);return result;
  });
  fs.writeFileSync('artifacts/api-check.json',JSON.stringify({testedAt:new Date().toISOString(),results},null,2));
  process.exitCode=results.some(row=>!row.ok)?1:0;
})();
