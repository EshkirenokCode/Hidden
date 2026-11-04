const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('../electron/provider.cjs');
const request = { question: 'Что такое индекс?', context: 'Backend developer', model: 'test-model', style: 'brief' };
test('sends context with store disabled and extracts all output text', async () => {
  const answer = await generate(request, 'test-key', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.match(body.input, /Backend developer/);
    return { ok: true, json: async () => ({ output: [{ type: 'reasoning' }, { content: [{ type: 'output_text', text: 'Ответ' }] }] }) };
  });
  assert.equal(answer, 'Ответ');
});
test('rejects invalid inputs and missing credentials without network calls', async () => {
  const network = () => { throw Error('Unexpected network'); };
  await assert.rejects(generate({ ...request, question: ' ' }, 'key', network), /Введите вопрос/);
  await assert.rejects(generate({ ...request, context: 'a'.repeat(30001) }, 'key', network), /Контекст/);
  await assert.rejects(generate(request, '', network), /API key/);
});
test('maps auth and quota errors without exposing server content', async () => {
  for (const status of [401, 429, 500]) await assert.rejects(generate(request, 'secret', async () => ({ ok: false, status })), /API|Лимит/);
});
test('rejects empty and incomplete answers', async () => {
  for (const data of [{ output: [] }, { status: 'incomplete', output: [] }]) await assert.rejects(generate(request, 'key', async () => ({ ok: true, json: async () => data })), /ответ/);
});
const geminiRequest = { ...request, provider: 'gemini', model: 'gemini-3.5-flash-lite' };
test('Gemini uses isolated key header, low latency config and stateless Interactions API', async () => {
  const answer = await generate(geminiRequest, 'gemini-test-key', async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'gemini-test-key');
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.generation_config.thinking_level, 'minimal');
    assert.match(body.input, /Backend developer/);
    return { ok: true, json: async () => ({ status: 'completed', steps: [{ type: 'thought', summary: [{ type: 'text', text: 'Do not display' }] }, { type: 'model_output', content: [{ type: 'text', text: 'Gemini answer' }] }] }) };
  });
  assert.equal(answer, 'Gemini answer');
});
test('Gemini handles missing keys, unknown provider, quota and malformed responses', async () => {
  const noNetwork = () => { throw Error('Unexpected network'); };
  await assert.rejects(generate(geminiRequest, '', noNetwork), /Gemini API key/);
  await assert.rejects(generate({ ...request, provider: 'unknown' }, 'key', noNetwork), /провайдер/);
  for (const status of [400, 401, 403, 404, 429, 500]) await assert.rejects(generate(geminiRequest, 'secret', async () => ({ ok: false, status })), /Gemini/);
  for (const data of [{ status: 'completed', steps: [] }, { status: 'incomplete' }, { status: 'failed' }]) await assert.rejects(generate(geminiRequest, 'key', async () => ({ ok: true, json: async () => data })), /Gemini/);
});
