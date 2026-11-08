const {test}=require('node:test'); const assert=require('node:assert/strict');
test('technical vocabulary is bounded, deduplicated and includes vacancy terms',async()=>{
  const {vocabulary}=await import('../src/speech.mjs');
  const terms=vocabulary('Go,go,ClickHouse,AcmeSDK','Backend with OpenTelemetry and PostgreSQL');
  assert.ok(terms.includes('OpenTelemetry'));assert.ok(terms.includes('ClickHouse'));
  assert.equal(terms.filter(x=>x.toLowerCase()==='go').length,1);
  assert.equal(vocabulary(Array(120).fill(0).map((_,i)=>'term'+i).join(',')).length,100);
});
test('Go correction is contextual and never changes the Dutch language',async()=>{
  const {normalizeTerms}=await import('../src/speech.mjs');
  assert.match(normalizeTerms('Расскажите об особенностях языка Голанд.').text,/Go \(Golang\)/);
  assert.equal(normalizeTerms('Изучаю голландский язык.').corrections.length,0);
  assert.equal(normalizeTerms('Голанд приехал на встречу.').corrections.length,0);
});
test('questions join unfinished clips, suppress short duplicates and ignore chatter',async()=>{
  const {QuestionTurns}=await import('../src/speech.mjs');const turns=new QuestionTurns();
  assert.equal(turns.accept('Привет, рад видеть.',1000).question,'');
  assert.equal(turns.accept('Расскажите об особенностях языка',2000).question,'');
  assert.equal(turns.accept('Голанг.',3000).question,'Расскажите об особенностях языка Go (Golang).');
  assert.equal(turns.accept('Что такое DNS?',4000).question,'Что такое DNS?');
  assert.equal(turns.accept('Что такое DNS?',5000).question,'');
  assert.equal(turns.accept('Чем отличается TCP от UDP?',6000).question,'Чем отличается TCP от UDP?');
  assert.equal(turns.accept('What is a goroutine?',7000).question,'What is a goroutine?');
  assert.equal(turns.accept('Я знаю, что такое Go.',8000).question,'');
});
test('PCM resampling is invariant to packet boundaries and preserves clipping and duration',async()=>{
  const {PcmPackets}=await import('../src/speech.mjs');
  const input=Float32Array.from({length:48001},(_,i)=>Math.sin(i/50)*1.2);
  function run(size){const output=[];const pcm=new PcmPackets(48000,b=>output.push(Buffer.from(b)));for(let i=0;i<input.length;i+=size)pcm.push(input.slice(i,i+size));pcm.flush();return Buffer.concat(output);}
  const a=run(480),b=run(137);assert.deepEqual(a,b);assert.equal(a.length,32000);
  const samples=new Int16Array(a.buffer,a.byteOffset,a.length/2);assert.equal(Math.max(...samples),32767);assert.equal(Math.min(...samples),-32768);
});
test('VAD retains about 300 ms before speech independent of native packet size',async()=>{
  const {SpeechSegments}=await import('../src/audio.mjs');let result;
  const vad=new SpeechSegments(48000,b=>result=b);
  for(let i=0;i<100;i++)vad.push(new Float32Array(480));
  assert.equal(vad.preSamples,14400);
  for(let i=0;i<40;i++)vad.push(new Float32Array(480).fill(.01));
  for(let i=0;i<70;i++)vad.push(new Float32Array(480));
  assert.ok(result);assert.ok(new DataView(result).getUint32(40,true)>=48000*2);
});

test('dialogue retains the original topic across short follow-ups and can recall a named older topic', async () => {
  const { selectDialogue } = await import('../src/dialogue.mjs');
  const turns = [
    { question: 'Как работает PostgreSQL?', answer: 'PostgreSQL uses MVCC.' },
    { question: 'Как Redis удаляет ключи?', answer: 'Redis applies an eviction policy.' },
    ...['А почему?', 'Приведи пример', 'А второй?', 'А при нагрузке?']
      .map(question => ({ question, answer: 'Follow-up about Redis.' }))
  ];
  assert.equal(selectDialogue(turns, 'А дальше?')[0].question, 'Как Redis удаляет ключи?');
  assert.equal(selectDialogue(turns, 'Вернёмся к PostgreSQL')[0].answer, 'PostgreSQL uses MVCC.');
});

test('the original topic survives eviction of the initial exchange', async () => {
  const { rememberDialogueTurn, selectDialogue } = await import('../src/dialogue.mjs');
  const turns = [];
  rememberDialogueTurn(turns, 'Как PostgreSQL обрабатывает блокировки?', 'Сначала разделим блокировки строк и таблиц.');
  for (let i = 0; i < 45; i++) rememberDialogueTurn(turns, 'Приведи пример', 'Пример ' + i);
  const history = selectDialogue(turns, 'А второй вариант?');
  assert.match(history[0].question, /PostgreSQL/);
  assert.match(history[0].answer, /строк и таблиц/);
  assert.equal(history.at(-1).answer, 'Пример 44');
  rememberDialogueTurn(turns, 'Как работает DNS?', 'DNS разрешает имена.');
  assert.equal(selectDialogue(turns, 'А почему?').some(turn => /PostgreSQL/.test(turn.question)), false);
});

test('speech detects a contextual request for an example without question punctuation', async () => {
  const { QuestionTurns } = await import('../src/speech.mjs');
  assert.equal(new QuestionTurns().accept('Приведи пример', 1000, true).question, 'Приведи пример');
  assert.equal(new QuestionTurns().accept('Приведи пример', 1000).question, '');
});
