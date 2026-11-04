const {test}=require('node:test');const assert=require('node:assert/strict');
const {LiveTranscriber}=require('../electron/live-transcriber.cjs');
function transport(){const socket=new EventTarget();socket.sent=[];socket.bufferedAmount=0;socket.send=x=>socket.sent.push(JSON.parse(x));socket.close=()=>socket.dispatchEvent(new Event('close'));socket.receive=x=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(x)}));return socket;}
test('Live setup, interim/final distinction, PCM, end-turn and deliberate stop',async()=>{
  const socket=transport(),events=[];const client=new LiveTranscriber(x=>events.push(x),()=>socket);
  const started=client.start('fake-key',['Golang']);socket.dispatchEvent(new Event('open'));
  assert.deepEqual(socket.sent[0].setup.inputAudioTranscription.customVocabulary,['Golang']);
  assert.equal(client.send('AAAA'),false);
  socket.receive({setupComplete:{}});await started;assert.equal(client.send('AAAA'),true);
  assert.equal(socket.sent[1].realtimeInput.audio.mimeType,'audio/pcm;rate=16000');
  socket.receive({serverContent:{interimInputTranscription:{text:'Расскажите'},inputTranscription:{text:'Что такое Go?'}}});
  assert.deepEqual(events.map(x=>x.type),['interim','final']);
  client.endTurn();assert.equal(socket.sent.at(-1).realtimeInput.audioStreamEnd,true);
  client.stop();socket.receive({serverContent:{inputTranscription:{text:'Late data'}}});assert.equal(events.length,2);
});
test('Live sanitizes server errors and rejects a pending start on stop',async()=>{
  const socket=transport();const client=new LiveTranscriber(()=>{},()=>socket);
  const started=client.start('sensitive-key');socket.receive({error:{code:403,message:'sensitive-key raw response'}});
  await assert.rejects(started,error=>!error.message.includes('sensitive-key')&&/доступ/.test(error.message));
  const next=client.start('key');client.stop();await assert.rejects(next,/остановлено/);
});
test('Live bounds backpressure and reports unexpected closure',async()=>{
  const socket=transport(),events=[];const client=new LiveTranscriber(x=>events.push(x),()=>socket);
  let pending=client.start('key');socket.receive({setupComplete:{}});await pending;
  socket.bufferedAmount=128001;assert.equal(client.send('AAAA'),false);assert.equal(client.ready,false);assert.equal(events.length,1);
  pending=client.start('key');socket.receive({setupComplete:{}});await pending;socket.close();assert.equal(events.length,2);
});
