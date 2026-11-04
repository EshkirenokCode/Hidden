const { generate } = require('./provider.cjs');

const defaults = { firstMs: 30000, idleMs: 20000, totalMs: 60000, noticeMs: 5000 };

// A slow first token is not a stalled stream. Bound each stage separately.
async function generateVoiceAnswer(request, key, fetchImpl, { signal, onDelta, onNotice = () => {}, limits = defaults, generateImpl = generate } = {}) {
  const budget = { ...defaults, ...limits }, deadline = new AbortController();
  const started = performance.now(); let firstTokenMs, text = '', timeoutStage;
  let firstTimer, idleTimer, totalTimer, noticeTimer;
  const expire = stage => { timeoutStage = stage; deadline.abort(new DOMException('Voice deadline', 'TimeoutError')); };
  firstTimer = setTimeout(() => expire('first'), budget.firstMs);
  totalTimer = setTimeout(() => expire('total'), budget.totalMs);
  noticeTimer = setTimeout(() => onNotice('Gemini отвечает медленнее обычного · запрос продолжается, вопрос сохранён'), budget.noticeMs);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    const answer = await generateImpl({ ...request, provider: 'gemini' }, key, fetchImpl, { signal: combined, onDelta: delta => {
      if (combined.aborted || !delta) return;
      firstTokenMs ??= Math.round(performance.now() - started);
      clearTimeout(firstTimer); clearTimeout(noticeTimer); clearTimeout(idleTimer);
      idleTimer = setTimeout(() => expire('idle'), budget.idleMs);
      text += delta; onDelta?.(delta, firstTokenMs);
    } });
    return { answer, firstTokenMs, model: request.model };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!timeoutStage) throw error;
    const messages = {
      first: `Gemini не начал ответ за ${Math.round(budget.firstMs / 1000)} с. Вопрос сохранён — можно повторить или сменить модель.`,
      idle: `Gemini перестал передавать текст на ${Math.round(budget.idleMs / 1000)} с. Полученная часть ответа сохранена.`,
      total: `Ответ превысил ${Math.round(budget.totalMs / 1000)} с. ${text ? 'Полученная часть сохранена.' : 'Вопрос сохранён — можно повторить.'}`
    };
    return { error: messages[timeoutStage], timeoutStage, partialAnswer: text, firstTokenMs, model: request.model };
  } finally {
    clearTimeout(firstTimer); clearTimeout(idleTimer); clearTimeout(totalTimer); clearTimeout(noticeTimer);
  }
}
module.exports = { generateVoiceAnswer };
