const $ = s => document.querySelector(s);
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function showError(message) { $('#error').hidden = !message; $('#error').textContent = message || ''; }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { showError('Не удалось сохранить данные на устройстве.'); } }
let history = read('ghost.history', []);
if (!Array.isArray(history)) history = [];
history = history.filter(x => typeof x?.question === 'string' && typeof x?.answer === 'string').slice(0, 30);
let currentAnswer = '', busy = false, pinned = false, streamingText = '', pendingImage = null;
let selectedEntry = null, readingHistory = false, unread = 0;
let syncedQuestion = '', heardQuestion = '';
let speechStream = null, speechPaint;
function beginSpeechAnswer(id, question) {
  clearTimeout(speechPaint); speechStream = { id, question, text: '' };
  if (!busy && !readingHistory) { showError(''); showAnswer(''); $('#answer-question').textContent = question; $('#timing').textContent = 'Готовим ответ…'; }
}
function speechDelta(id, text) {
  if (speechStream?.id !== id) return;
  speechStream.text += text;
  if (speechPaint) return;
  speechPaint = setTimeout(() => {
    speechPaint = null;
    if (speechStream?.id !== id || busy || readingHistory) return;
    showAnswer(speechStream.text, true); $('#answer-question').textContent = speechStream.question;
    $('#timing').textContent = 'Ответ поступает…';
  }, 40);
}
function endSpeechAnswer(id, interrupted = false) {
  if (id !== undefined && speechStream?.id !== id) return;
  clearTimeout(speechPaint); speechPaint = null;
  if (speechStream && !busy && !readingHistory) {
    if (speechStream.text) showAnswer(speechStream.text, true);
    $('#timing').textContent = interrupted && speechStream.text ? 'Ответ прерван · полученная часть сохранена' : 'Генерация завершена или остановлена';
  }
  speechStream = null;
}
function receiveQuestion(question) {
  heardQuestion = question;
  const field = $('#question');
  if (!field.value.trim() || field.value === syncedQuestion) {
    field.value = question; syncedQuestion = question;
    $('#question-origin').textContent = 'Распознанный вопрос';
    $('#use-heard').hidden = true;
  } else {
    $('#question-origin').textContent = 'Ваш текст · распознан новый вопрос';
    $('#use-heard').hidden = false;
  }
}
$('#question').addEventListener('input', () => {
  $('#question-origin').textContent = $('#question').value.trim() ? 'Ваш текст' : 'Введите вопрос или начните слушать';
  $('#use-heard').hidden = !heardQuestion || $('#question').value === heardQuestion;
});
$('#use-heard').onclick = () => { $('#question').value = ''; receiveQuestion(heardQuestion); };
function followLive() { readingHistory = false; unread = 0; navigation(); }
let fitTimer;
function scheduleFit() {
  if (fitTimer || !document.body.classList.contains('compact')) return;
  fitTimer = setTimeout(async () => {
    fitTimer = null;
    if (!document.body.classList.contains('compact')) return;
    const main = document.querySelector('main'), answer = $('#answer');
    const wasLimited = document.body.classList.contains('height-limited');
    document.body.classList.remove('height-limited');
    const naturalHeight = main.getBoundingClientRect().height + Math.max(0, answer.scrollHeight - answer.clientHeight) + 2;
    document.body.classList.toggle('height-limited', wasLimited);
    const result = await window.ghost.fitContent(naturalHeight);
    if (!result || !document.body.classList.contains('compact')) return;
    document.documentElement.style.setProperty('--overlay-max-height', result.maxHeight + 'px');
    document.body.classList.toggle('height-limited', result.limited);
  }, 32);
}
new ResizeObserver(scheduleFit).observe(document.querySelector('main'));
new MutationObserver(scheduleFit).observe(document.querySelector('main'), { childList: true, characterData: true, subtree: true });
window.addEventListener('resize', scheduleFit);
const storedOpacity = Number(read('hidden.overlayOpacity', 38));
$('#overlay-opacity').value = Number.isFinite(storedOpacity) ? Math.max(15, Math.min(85, storedOpacity)) : 38;
function opacity() { const value = Number($('#overlay-opacity').value); document.documentElement.style.setProperty('--overlay-alpha', String(value / 100)); $('#opacity-value').textContent = value + '%'; save('hidden.overlayOpacity', value); }
$('#overlay-opacity').oninput = opacity; opacity();
$('#click-through').onclick = async () => { const result = await window.ghost.clickThrough($('#click-through').getAttribute('aria-pressed') !== 'true'); if (result.error) showError(result.error); };
$('#session-details').onclick = () => { document.body.classList.toggle('audio-expanded'); $('#session-details').setAttribute('aria-expanded', String(document.body.classList.contains('audio-expanded'))); scheduleFit(); };
$('#context').value = String(read('ghost.context', '')).slice(0, 30000);
$('#custom-prompt').value = String(read('ghost.prompt', '')).slice(0, 4000);
$('#speech-vocabulary').value = String(read('hidden.vocabulary', '')).slice(0, 6000);
$('#speech-vocabulary').oninput = () => save('hidden.vocabulary', $('#speech-vocabulary').value);
$('#recognition-mode').value = ['auto','live','batch'].includes(read('hidden.recognitionMode','auto')) ? read('hidden.recognitionMode','auto') : 'auto';
$('#recognition-mode').onchange = () => save('hidden.recognitionMode', $('#recognition-mode').value);
const providerLabels = { gemini: 'Gemini', groq: 'Groq', openai: 'OpenAI' };
const groqModel = 'openai/gpt-oss-20b';
const groqScreenModel = 'qwen/qwen3.8-27b';
const screenMode = () => {
  const saved = read('ghost.screenProvider', 'gemini');
  if (saved === 'qwen') return 'qwen';
  if (saved === 'groq') return navigator.platform.includes('Mac') ? 'groq' : 'qwen';
  return 'gemini';
};
const screenProvider = () => screenMode() === 'gemini' ? 'gemini' : 'groq';
function updateScreenKeyVisibility() {
  $('#groq-screen-key-settings').hidden = $('#provider').value === 'groq' || $('#screen-provider').value === 'gemini';
}
const geminiModel = () => String($('#provider').value === 'gemini' ? $('#model').value.trim() : read('ghost.model.gemini', 'gemini-3.5-flash-lite')) || 'gemini-3.5-flash-lite';
$('#provider').value = ['openai', 'gemini', 'groq'].includes(read('ghost.provider', 'gemini')) ? read('ghost.provider', 'gemini') : 'gemini';
function loadProvider() {
  const provider = $('#provider').value;
  $('#model').readOnly = provider === 'groq';
  $('#model').value = provider === 'groq' ? groqModel : String(read(`ghost.model.${provider}`, provider === 'openai' ? read('ghost.model', '') : 'gemini-3.5-flash-lite'));
  $('#key-label').textContent = `${providerLabels[provider]} API key`;
  $('#test-key').textContent = `Проверить ${providerLabels[provider]}`;
  $('#gemini-key-settings').hidden = provider === 'gemini';
  updateScreenKeyVisibility();
  $('#gemini-key').value = '';
  $('#settings-error').textContent = '';
  $('#api-key').value = ''; $('#model').setAttribute('list', provider === 'gemini' ? 'model-options' : '');
}
function config(question = '', includeSpeech = false) { return { provider: $('#provider').value, model: $('#model').value.trim(), recognitionModel: geminiModel(), context: $('#context').value, vocabulary: $('#speech-vocabulary').value, recognitionMode: $('#recognition-mode').value, style: $('#style').value, customPrompt: $('#custom-prompt').value, dialogue: window.ghostSession?.dialogue(question) || [], conversation: includeSpeech ? window.ghostSession?.recentSpeech() || '' : '' }; }
const answerMarkdown = window.markdownit({ html: false, linkify: false, breaks: true });
// Model output can format text, but it cannot navigate or load images.
answerMarkdown.renderer.rules.link_open = () => '<span class="answer-link">';
answerMarkdown.renderer.rules.link_close = () => '</span>';
answerMarkdown.renderer.rules.image = (tokens, index) => answerMarkdown.utils.escapeHtml(tokens[index].content);
function showAnswer(answer, streaming = false) {
  const box = $('#answer');
  const scroll = box.scrollTop;
  const following = box.scrollHeight - scroll - box.clientHeight < 32;
  currentAnswer = answer;
  $('#timing').textContent = '';
  box.innerHTML = answerMarkdown.render(answer);
  box.classList.add('has-answer');
  $('#copy').disabled = !answer;
  box.scrollTop = streaming ? (following ? box.scrollHeight : scroll) : 0;
}
function navigation() {
  const index = selectedEntry ? history.indexOf(selectedEntry) : -1;
  $('#answer-position').textContent = index >= 0 ? `${history.length - index} / ${history.length}` : 'Нет выбранного ответа';
  $('#previous-answer').disabled = busy || !history.length || index >= history.length - 1;
  $('#next-answer').disabled = busy || index <= 0;
  $('#latest-answer').hidden = !unread && !readingHistory;
  $('#latest-answer').textContent = unread ? `Новых: ${unread} · показать` : 'К свежему ответу';
}
function selectEntry(entry) {
  if (!entry || busy) return;
  selectedEntry = entry; readingHistory = entry !== history[0];
  if (!readingHistory) unread = 0;
  showAnswer(entry.answer); $('#answer-question').textContent = entry.question; navigation();
}
function navigate(direction) { const index = selectedEntry ? history.indexOf(selectedEntry) : -1; selectEntry(history[Math.max(0, Math.min(history.length - 1, index + direction))]); }
$('#previous-answer').onclick = () => navigate(1); $('#next-answer').onclick = () => navigate(-1); $('#latest-answer').onclick = () => selectEntry(history[0]);
window.ghost.onNavigate(navigate);
function renderHistory() {
  $('#history').replaceChildren();
  if (!history.length) { const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'Здесь появятся вопросы сессии.'; $('#history').append(p); }
  history.forEach(item => { const button = document.createElement('button'); button.className = 'history-item'; button.textContent = item.question; button.title = item.question; button.onclick = () => selectEntry(item); $('#history').append(button); });
  navigation();
}
function presentResult(result, question, audio = false, memoryQuestion = question) {
  window.ghostSession?.rememberAnswer(memoryQuestion, result.answer);
  const entry = { question, answer: result.answer };
  const follow = !audio || (!busy && !readingHistory);
  history.unshift(entry);
  // Keep the answer being read available even while fresh answers arrive.
  if (history.length > 30) { const drop = history.findLastIndex(item => item !== selectedEntry); history.splice(drop, 1); }
  if (follow) {
    selectedEntry = entry; readingHistory = false; unread = 0;
    showAnswer(result.answer);
    $('#answer-question').textContent = question;
    $('#timing').textContent = `${result.model || $('#model').value} · ${result.firstTokenMs != null ? `первые слова ${(result.firstTokenMs / 1000).toFixed(2)} с · ` : ''}ответ ${(result.elapsedMs / 1000).toFixed(2)} с`;
  } else unread++;
  save('ghost.history', history); renderHistory();
}
async function updateStatus() {
  const provider = $('#provider').value;
  const [connected, gemini, groq] = await Promise.all([window.ghost.keyStatus(provider), window.ghost.keyStatus('gemini'), window.ghost.keyStatus('groq')]);
  if (provider !== $('#provider').value) return;
  $('#connection').textContent = `${providerLabels[provider]} · ${connected ? 'ключ добавлен' : 'API не подключён'}`;
  $('#gemini-key-status').textContent = gemini ? 'Ключ Gemini добавлен' : 'Ключ Gemini не добавлен';
  $('#groq-screen-key-status').textContent = groq ? 'Ключ Groq добавлен' : 'Ключ Groq не добавлен';
}
const shortcutFields = ['answer', 'snapshot'];
let activeChords = {};
function showShortcutFields() {
  for (const name of shortcutFields) $('#shortcut-' + name).value = activeChords[name] || '';
}
for (const name of shortcutFields) {
  $('#shortcut-' + name).onkeydown = event => {
    if (['Tab', 'Escape'].includes(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) return;
    event.preventDefault();
    if (event.isComposing || (event.metaKey && event.ctrlKey) ||
        (navigator.platform.includes('Mac') ? event.ctrlKey : event.metaKey)) return;
    const key = /^(Key[A-Z]|Digit[0-9]|Arrow(?:Left|Right|Up|Down))$/.test(event.code)
      ? event.code.replace(/^(Key|Digit|Arrow)/, '') : event.code;
    if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Enter|Left|Right|Up|Down)$/.test(key)) return;
    const command = event.metaKey || event.ctrlKey;
    if (!command && !event.altKey) return;
    event.currentTarget.value = [command && 'CommandOrControl', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
  };
}
$('#shortcut-defaults').onclick = () => {
  $('#shortcut-answer').value = 'CommandOrControl+Shift+Space';
  $('#shortcut-snapshot').value = 'CommandOrControl+Shift+B';
};
function syncShortcuts(shortcuts) {
  if (!shortcuts?.answer || !shortcuts.snapshot) return;
  activeChords = Object.fromEntries(shortcutFields.map(name => [name, shortcuts[name].chord]));
  const label = name => shortcuts[name].registered ? ' · ' + shortcuts[name].chord.replace('CommandOrControl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl') : '';
  $('#answer-last').textContent = 'Ответить на последний' + label('answer');
  $('#answer-heard').title = 'Ответить на услышанное' + label('answer');
  $('#capture-screen').textContent = '▣ Ответ с экрана' + label('snapshot');
  $('#compact-snapshot').title = 'Ответ с экрана' + label('snapshot');
  const missing = Object.values(shortcuts).filter(x => !x.registered).map(x => x.chord.replace('CommandOrControl', 'Cmd/Ctrl'));
  $('#shortcut-warning').hidden = !missing.length;
  $('#shortcut-warning').textContent = `Сочетания заняты: ${missing.join(', ')}. Используйте кнопки в окне.`;
}
async function updatePrivacy() {
  const state = await window.ghost.privacyStatus();
  syncWindow(state);
  $('#privacy-status').textContent = state.platform === 'darwin' ? 'Защита окна: ограничена на macOS · весь экран может показать помощника' : state.protectionRequested ? 'Защита окна включена · результат у зрителя не проверен' : 'Защита окна от захвата не поддерживается';
  $('#privacy').textContent = state.platform === 'darwin' ? 'macOS: защита включена, но ScreenCaptureKit может захватить окно. Универсальная невидимость не гарантируется. Передавайте отдельное окно другого приложения и проверьте результат у зрителя.' : state.protectionRequested ? 'Защита от захвата включена. Проверьте результат у зрителя.' : 'На этой ОС исключение из захвата не поддерживается.';
  $('#hide-window').textContent = state.shortcutRegistered ? 'Скрыть / вернуть · ⌘/Ctrl + Shift + H' : state.platform === 'darwin' ? 'Скрыть окно · вернуть через строку меню' : 'Скрыть окно';
  syncShortcuts(state.shortcuts);
}
function syncWindow(state) { pinned = state.pinned; $('#pin').setAttribute('aria-pressed', String(pinned)); $('#pin').textContent = pinned ? '↗ Закреплено' : '↗ Поверх окон'; $('#click-through').setAttribute('aria-pressed', String(Boolean(state.clickThrough))); $('#click-through').textContent = state.clickThrough ? 'Клики сквозь · ⌘⇧M' : 'Сквозь клики'; }
window.ghost.onWindowState(state => { syncWindow(state); syncShortcuts(state.shortcuts); });
$('#hide-stop').onclick = () => window.ghost.hideStop();
window.ghost.onStop(() => { window.ghostSession?.stop(); $('#remove-snapshot').click(); showError(''); });
loadProvider();
if (!/Mac|Win/.test(navigator.platform)) {
  $('#key-storage-note').textContent = 'Ключ хранится до выхода из приложения. Пустое поле сохраняет текущий ключ.';
}
$('#provider').onchange = () => { if (window.ghostSession?.active()) window.ghostSession.stop(); loadProvider(); save('ghost.provider', $('#provider').value); updateStatus(); };
$('#hide-window').onclick = () => window.ghost.hide();
$('#context').oninput = () => { save('ghost.context', $('#context').value); $('#context-status').textContent = 'Сохранено на этом устройстве'; };
$('#custom-prompt').oninput = () => save('ghost.prompt', $('#custom-prompt').value);
$('#settings-open').onclick = () => $('#settings').showModal();
$('#settings').addEventListener('beforetoggle', event => {
  if (event.newState !== 'open') return;
  showShortcutFields();
  $('#screen-provider').value = screenMode();
  $('#screen-provider').querySelector('[value=groq]').disabled = !navigator.platform.includes('Mac');
  updateScreenKeyVisibility();
});
$('#screen-provider').onchange = updateScreenKeyVisibility;
$('#settings-close').onclick = () => $('#settings').close();
$('#settings').addEventListener('close', () => { $('#api-key').value = ''; $('#gemini-key').value = ''; $('#groq-screen-key').value = ''; });
async function saveGeminiKey() {
  const input = $('#provider').value === 'gemini' ? $('#api-key') : $('#gemini-key');
  if (input.value.trim()) { await window.ghost.setKey('gemini', input.value); input.value = ''; }
}
async function saveSettings() {
  await saveGeminiKey();
  if ($('#provider').value !== 'gemini' && $('#api-key').value.trim()) await window.ghost.setKey($('#provider').value, $('#api-key').value);
  $('#api-key').value = ''; save(`ghost.model.${$('#provider').value}`, $('#model').value.trim()); save('ghost.provider', $('#provider').value); await updateStatus();
}
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const request = Object.fromEntries(shortcutFields.map(name => [name, $('#shortcut-' + name).value]));
    if (shortcutFields.some(name => request[name] !== activeChords[name])) {
      const result = await window.ghost.saveShortcuts(request);
      if (result.error) throw Error(result.error);
      syncShortcuts(result.shortcuts);
    }
    await saveSettings();
    const groqScreenKey = $('#groq-screen-key');
    if (!$('#groq-screen-key-settings').hidden && groqScreenKey.value.trim()) await window.ghost.setKey('groq', groqScreenKey.value);
    if (screenMode() !== $('#screen-provider').value) $('#remove-snapshot').click();
    save('ghost.screenProvider', $('#screen-provider').value);
    $('#settings').close();
  } catch (error) { $('#settings-error').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#test-key').onclick = async () => {
  const { provider, model } = config();
  $('#test-key').disabled = true; $('#settings-error').textContent = `Проверяем ${providerLabels[provider]}…`;
  try { await saveSettings(); const result = await window.ghost.testKey(model, provider); if (result.error) throw Error(result.error); $('#settings-error').textContent = `Подключение работает · ${(result.elapsedMs / 1000).toFixed(2)} с`; }
  catch (error) { $('#settings-error').textContent = error.message; }
  finally { $('#test-key').disabled = false; }
};
async function forgetKey(provider, input) {
  try {
    await window.ghost.setKey(provider, '');
    $(input).value = '';
    $('#settings-error').textContent = '';
    await updateStatus();
  } catch (error) { $('#settings-error').textContent = error.message; }
}
$('#forget-groq-screen').onclick = () => forgetKey('groq', '#groq-screen-key');
$('#forget-key').onclick = () => forgetKey($('#provider').value, '#api-key');
$('#forget-gemini').onclick = () => forgetKey('gemini', '#gemini-key');
$('#test-live').onclick = async () => {
  const button = $('#test-live'); button.disabled = true;
  $('#settings-error').textContent = 'Проверяем доступ к Live · без передачи аудио…';
  try {
    await saveGeminiKey(); await updateStatus();
    const result = await window.ghost.testLiveSpeech();
    $('#settings-error').textContent = result.error || `Live доступен · подключение ${(result.elapsedMs / 1000).toFixed(2)} с. Аудио не отправлялось.`;
  } catch (error) { $('#settings-error').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#pin').onclick = async () => { pinned = await window.ghost.pin(!pinned); $('#pin').setAttribute('aria-pressed', String(pinned)); $('#pin').textContent = pinned ? '↗ Закреплено' : '↗ Поверх окон'; };
async function compact(enabled) { const active = await window.ghost.compact(enabled); document.body.classList.toggle('compact', active); document.documentElement.classList.toggle('overlay-root', active); if (!active) document.body.classList.remove('height-limited'); $('#compact').textContent = active ? 'Развернуть' : 'Компактно'; scheduleFit(); }
$('#compact').onclick = () => compact(!document.body.classList.contains('compact'));
$('#clear').onclick = () => { history = []; selectedEntry = null; readingHistory = false; unread = 0; save('ghost.history', history); renderHistory(); };
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText(currentAnswer); $('#copy').textContent = 'Скопировано'; setTimeout(() => { $('#copy').textContent = 'Копировать'; }, 1500); } catch { showError('Не удалось скопировать.'); } };
$('#demo').onclick = () => { $('#answer-question').textContent = 'Пример ответа · не отправляется в API'; showAnswer('Демонстрация · подготовленный пример\n\nOptimistic locking проверяет версию записи при обновлении. Если версия изменилась, операция повторяется или возвращает конфликт.\n\nPessimistic locking блокирует запись на время транзакции. Другие операции ждут. Подходит при частых конфликтах, но требует коротких транзакций и контроля deadlock.'); };
let answerPaint;
window.ghost.onAnswerNotice(message => { if (busy) $('#timing').textContent = message; });
window.ghost.onDelta(({ text }) => {
  if (!busy) return;
  streamingText += text;
  if (answerPaint) return;
  answerPaint = setTimeout(() => {
    answerPaint = null;
    showAnswer(streamingText, true);
    $('#timing').textContent = 'Генерация…';
  }, 40);
});
$('#cancel-answer').onclick = () => window.ghost.cancel();
$('#remove-snapshot').onclick = () => {
  pendingImage = null;
  $('#snapshot-preview').hidden = true;
  $('#snapshot-image').removeAttribute('src');
  $('#snapshot-text-details').hidden = true;
  $('#snapshot-text-details').open = false;
  $('#snapshot-text').value = '';
};
$('#snapshot-text').oninput = () => {
  if (pendingImage) pendingImage.screenText = $('#snapshot-text').value;
};
const screenQuestion = 'Реши задачи в основном содержимом окна. Ответь на каждый полностью видимый вопрос в исходном порядке. В начале дай список конечных ответов и отметь обрезанные задания. Разбор вынеси после этого списка. Обрезанные задания пропусти без решения.';
async function ask(question, { image = pendingImage, preserveDraft = false, title, heard = false } = {}) {
  if (busy) return;
  if (!question.trim() && !image) { showError('Введите вопрос или дождитесь распознавания речи.'); return; }
  const submittedDraft = $('#question').value;
  busy = true; streamingText = ''; $('#submit').disabled = true; $('#cancel-answer').hidden = false; $('.answer-card').setAttribute('aria-busy', 'true'); showError('');
  navigation();
  try {
    await window.ghostSession?.cancelAnswer();
    question = question.trim() || screenQuestion;
    const request = config(question, heard);
    if (image) {
      const mode = screenMode();
      request.provider = screenProvider();
      if (mode === 'groq') {
        if (!image.screenText?.trim()) throw Error('Добавьте текст в поле «Распознанный текст» или сделайте новый снимок.');
        request.model = 'openai/gpt-oss-120b';
        request.screenText = image.screenText;
      } else {
        request.model = mode === 'qwen' ? groqScreenModel : request.recognitionModel;
        request.image = { data: image.data, mimeType: image.mimeType };
      }
    }
    if (!request.model || !(await window.ghost.keyStatus(request.provider))) { $('#settings').showModal(); return; }
    $('#answer-question').textContent = title || question;
    if (image) $('#timing').textContent = `${request.screenText ? 'GPT-OSS 120B' : request.provider === 'groq' ? 'Qwen' : 'Gemini'} отвечает…`;
    const result = await window.ghost.generate({ ...request, question });
    if (result.error) throw Error(result.error);
    presentResult(result, title || question, false, title ? title + '\n' + question : question); $('#connection').textContent = `${result.provider} · запрос выполнен`;
    if (!preserveDraft && $('#question').value === submittedDraft && submittedDraft.trim() === question) {
      $('#question').value = ''; syncedQuestion = '';
      $('#question-origin').textContent = 'Введите следующий вопрос или продолжайте говорить';
      $('#use-heard').hidden = true;
    }
  } catch (error) {
    if (streamingText) showAnswer(streamingText);
    showError(error.message);
  }
  finally {
    clearTimeout(answerPaint); answerPaint = null;
    busy = false; $('#submit').disabled = false; $('#cancel-answer').hidden = true; $('.answer-card').setAttribute('aria-busy', 'false'); navigation(); }
}
$('#question-form').onsubmit = event => { event.preventDefault(); ask($('#question').value); };
$('#question').onkeydown = event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $('#question-form').requestSubmit(); } };
$('#import-context').onclick = async () => { try { const result = await window.ghost.importContext(); if (result.error) throw Error(result.error); if (result.text !== undefined) { $('#context').value = result.text; $('#context').dispatchEvent(new Event('input')); } } catch (error) { showError(error.message); } };
window.copilot = {
  config, screenMode, screenProvider, presentResult, receiveQuestion, followLive, beginSpeechAnswer,
  speechDelta, endSpeechAnswer, showError, ask, compact, busy: () => busy,
  setImage(image, name) {
    pendingImage = image;
    $('#snapshot-image').src = `data:${image.mimeType};base64,${image.data}`;
    $('#snapshot-name').textContent = name;
    $('#snapshot-preview').hidden = false;
    $('#snapshot-text-details').hidden = !image.screenText;
    $('#snapshot-text-details').open = false;
    $('#snapshot-text').value = image.screenText || '';
  }
};
renderHistory(); updateStatus(); updatePrivacy();
