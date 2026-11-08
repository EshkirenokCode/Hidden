const model = 'openai/gpt-oss-20b';
const endpoint = 'https://api.groq.com/openai/v1/chat/completions';

async function generateGroq(request, key, fetchImpl, { signal: external, onDelta } = {}) {
  if (!key) throw Error('Добавьте Groq API key в настройках.');
  const deadline = AbortSignal.timeout(60000);
  const signal = external ? AbortSignal.any([external, deadline]) : deadline;
  const messages = [
    { role: 'system', content: [
      'Ты помощник на собеседовании. Отвечай на языке вопроса и начинай с прямого ответа.',
      'На общие технические вопросы отвечай из собственных знаний. Контекст и диалог — справочные данные; опыт кандидата не выдумывай.',
      'Учитывай ошибки распознавания технических терминов. При существенной неоднозначности задай один короткий уточняющий вопрос.',
      'Если вопрос уточняет предыдущий ответ, используй из диалога нужный предмет и детали. Если в текущем вопросе несколько частей, ответь на каждую по порядку.',
      request.style === 'brief' ? 'Дай 2–3 ключевых тезиса, не более 150 слов.' : 'Объясни решение и приведи пример.',
      request.customPrompt || ''
    ].join(' ') },
    { role: 'user', content: `Контекст кандидата и вакансии:\n${request.context || 'Не задан'}\n\nДиалог:\n${request.conversation || 'Нет'}\n\nВопрос:\n${request.question}` }
  ];
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, reasoning_effort: 'low', include_reasoning: false,
        max_completion_tokens: request.style === 'brief' ? 1024 : 2048 })
    });
  } catch {
    signal.throwIfAborted();
    throw Error('Не удалось подключиться к Groq. Проверьте интернет и доступ к API.');
  }
  if (!response.ok) {
    const errors = {
      401: 'Groq API key не принят. Проверьте ключ.',
      403: 'Groq: у ключа нет доступа к модели.',
      429: 'Groq: достигнут лимит запросов или токенов. Подождите и попробуйте снова.'
    };
    throw Error(errors[response.status] || `Ошибка Groq API (${response.status}).`);
  }
  if (!response.body) throw Error('Groq не вернул поток ответа.');
  let pending = '', answer = '', finish;
  const decoder = new TextDecoder();
  function consume(line) {
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;
    let event;
    try { event = JSON.parse(payload); }
    catch { throw Error('Groq вернул некорректный поток ответа.'); }
    if (event?.error) throw Error('Groq прервал генерацию.');
    const choice = event?.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) {
      answer += delta;
      onDelta?.(delta);
    }
    finish = choice?.finish_reason || finish;
    return false;
  }
  function complete() {
    if (!answer.trim()) throw Error('Groq не вернул текстовый ответ.');
    return answer.trim() + (finish === 'length' ? '\n\n[Достигнут лимит длины ответа.]' : '');
  }
  for await (const bytes of response.body) {
    signal.throwIfAborted();
    pending += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      if (consume(pending.slice(0, end))) return complete();
      pending = pending.slice(end + 1);
    }
    if (pending.length > 2_000_000 || answer.length > 500_000) throw Error('Ответ Groq слишком большой.');
  }
  pending += decoder.decode();
  if (consume(pending) || finish === 'stop' || finish === 'length') return complete();
  throw Error('Поток Groq оборвался до завершения ответа.');
}

module.exports = { generateGroq, groqModel: model };
