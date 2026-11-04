module.exports = async (url, options) => {
  if (!url.startsWith('https://generativelanguage.googleapis.com/v1beta/interactions') || options.headers['x-goog-api-key'] !== 'smoke-test-not-a-real-key') throw Error('Wrong provider routing');
  const body = JSON.parse(options.body);
  let answer = 'Gemini smoke response' + (typeof body.input === 'string' ? ': ' + body.input.split('Вопрос:\n').at(-1) : '');
  if(Array.isArray(body.input) && body.input.some(x=>x.type==='audio')) answer='Что такое DNS?';
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
