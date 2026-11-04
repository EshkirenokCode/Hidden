module.exports = async (url, options) => {
  if (!url.startsWith('https://generativelanguage.googleapis.com/v1beta/interactions') || options.headers['x-goog-api-key'] !== 'smoke-test-not-a-real-key') throw Error('Wrong provider routing');
  const body = JSON.parse(options.body);
  let answer = 'Gemini smoke response';
  if (body.response_format) answer = JSON.stringify({ transcript: 'What is an index?', question: 'What is an index?', answer: 'An index speeds up reads.' });
  if (body.stream) {
    const events = [
      { event_type: 'step.delta', delta: { type: 'thought_summary', text: 'must not show' } },
      { event_type: 'step.delta', delta: { type: 'text', text: answer } },
      { event_type: 'interaction.completed', interaction: { status: 'completed' } }
    ];
    const bytes = new TextEncoder().encode(events.map(x => `data: ${JSON.stringify(x)}\n\n`).join(''));
    return { ok: true, body: (async function* () { yield bytes.slice(0, 17); yield bytes.slice(17); })() };
  }
  return { ok: true, json: async () => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: answer }] }] }) };
};
