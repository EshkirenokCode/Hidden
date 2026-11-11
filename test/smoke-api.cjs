module.exports = async (url, options) => {
  if (url === 'https://api.groq.com/openai/v1/chat/completions') {
    const body = JSON.parse(options.body);
    if (options.headers.Authorization !== 'Bearer groq-smoke-not-a-real-key' || options.headers['x-goog-api-key'] ||
        body.model !== 'openai/gpt-oss-20b' || !body.stream || body.reasoning_effort !== 'low' ||
        body.include_reasoning !== false || body.messages.some(message => typeof message.content !== 'string')) throw Error('Wrong Groq routing');
    const input = body.messages.at(-1).content;
    const question = input.split('Вопрос:\n').at(-1);
    if (question === 'А для HTTPS?' && !(body.messages.at(-2)?.role === 'assistant' && body.messages.at(-2).content === 'Groq smoke response: Что такое DNS? Как работает TCP?' && body.messages.at(-3)?.content === 'Что такое DNS? Как работает TCP?')) {
      throw Error('Follow-up request is missing the previous manual answer');
    }
    const answer = 'Groq smoke response: ' + question;
    return { ok: true, body: (async function* () {
      const event = (delta, finish_reason = null) => 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\r\n\r\n';
      const bytes = new TextEncoder().encode(event({ reasoning: 'must not show' }) + event({ content: answer }));
      const split = bytes.findIndex(byte => byte > 127) + 1 || 18;
      yield bytes.slice(0, split); yield bytes.slice(split);
      await new Promise(resolve => setTimeout(resolve, 220));
      options.signal.throwIfAborted();
      yield new TextEncoder().encode(event({}, 'stop') + 'data: [DONE]\r\n\r\n');
    })() };
  }
  if (!url.startsWith('https://generativelanguage.googleapis.com/v1beta/interactions') || options.headers['x-goog-api-key'] !== 'smoke-test-not-a-real-key') throw Error('Wrong provider routing');
  const body = JSON.parse(options.body);
  let answer = 'Gemini smoke response' + (typeof body.input === 'string' ? ': ' + body.input.split('Вопрос:\n').at(-1) : '');
  if(Array.isArray(body.input) && body.input.some(x=>x.type==='audio')) {
    if (body.model !== 'gemini-3.5-flash-lite') throw Error('Wrong fallback transcription model');
    answer='Что такое DNS?';
  }
  if (Array.isArray(body.input) && body.input.some(item => item.type === 'image')) {
    const image = body.input.find(item => item.type === 'image');
    if (body.model !== 'gemini-3.8-flash' || body.generation_config?.thinking_level !== 'high' || image.resolution !== 'high') {
      throw Error('Screen request did not use the reasoning model and image detail');
    }
    const prompt = body.input.find(item => item.type === 'text')?.text || '';
    if (prompt.endsWith('Ответь на все семь вопросов')) {
      if (!prompt.includes('Помощник: Gemini screen response')) throw Error('Screen follow-up lost previous answer');
      answer = 'Gemini follow-up with screenshot';
    } else {
      if (prompt.includes('Найди все читаемые') && !prompt.includes('Ответь на каждый')) throw Error('Screen prompt ignored multiple items');
      answer = 'Gemini screen response';
    }
  }
  if (body.response_format) answer = JSON.stringify({ transcript: 'What is an index?', question: 'What is an index?', answer: 'An index speeds up reads.' });
  if (body.stream) {
    const events = [
      { event_type: 'step.delta', delta: { type: 'thought_summary', text: 'must not show' } },
      { event_type: 'step.delta', delta: { type: 'text', text: answer } },
      { event_type: 'interaction.completed', interaction: { status: 'completed' } }
    ];
    const bytes = new TextEncoder().encode(events.map(x => `data: ${JSON.stringify(x)}\n\n`).join(''));
    const end = bytes.length - new TextEncoder().encode('data: '+JSON.stringify(events.at(-1))+'\n\n').length;
    return { ok: true, body: (async function* () {
      if(options.signal?.aborted) throw new DOMException('Aborted','AbortError');
      if(typeof body.input==='string' && body.input.split('Вопрос:\n').at(-1).includes('DELAYED_TEST')) {
        await new Promise(resolve=>setTimeout(resolve,12000));
        if(options.signal?.aborted) throw new DOMException('Aborted','AbortError');
      }
      yield bytes.slice(0,17);yield bytes.slice(17,end);
      await new Promise(resolve=>setTimeout(resolve,220));
      if(options.signal?.aborted) throw new DOMException('Aborted','AbortError');
      yield bytes.slice(end);
    })() };
  }
  return { ok: true, json: async () => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: answer }] }] }) };
};
