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
$('#provider').value = ['openai', 'gemini'].includes(read('ghost.provider', 'gemini')) ? read('ghost.provider', 'gemini') : 'gemini';
function loadProvider() {
  const provider = $('#provider').value;
  $('#model').value = String(read(`ghost.model.${provider}`, provider === 'openai' ? read('ghost.model', '') : 'gemini-3.5-flash-lite'));
  $('#key-label').textContent = provider === 'gemini' ? 'Gemini API key' : 'OpenAI API key';
  $('#api-key').value = ''; $('#model').setAttribute('list', provider === 'gemini' ? 'model-options' : '');
}
function config() { return { provider: $('#provider').value, model: $('#model').value.trim(), context: $('#context').value, vocabulary: $('#speech-vocabulary').value, recognitionMode: $('#recognition-mode').value, style: $('#style').value, customPrompt: $('#custom-prompt').value, conversation: window.ghostSession?.conversation() || '' }; }
function showAnswer(answer, streaming = false) {
  const box = $('#answer'), scroll = box.scrollTop, following = box.scrollHeight - scroll - box.clientHeight < 32;
  currentAnswer = answer; $('#timing').textContent = ''; box.replaceChildren();
  const code = /```[^\n]*\n([\s\S]*?)```/g; let match, offset = 0;
  while ((match = code.exec(answer))) {
    box.append(document.createTextNode(answer.slice(offset, match.index)));
    const pre = document.createElement('pre'), text = document.createElement('code'); text.textContent = match[1]; pre.append(text); box.append(pre); offset = code.lastIndex;
  }
  box.append(document.createTextNode(answer.slice(offset))); box.classList.add('has-answer'); $('#copy').disabled = !answer;
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
function presentResult(result, question, audio = false) {
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
  const provider = $('#provider').value, connected = await window.ghost.keyStatus(provider);
  if (provider === $('#provider').value) $('#connection').textContent = `${provider === 'gemini' ? 'Gemini' : 'OpenAI'} · ${connected ? 'ключ добавлен' : 'API не подключён'}`;
}
async function updatePrivacy() {
  const state = await window.ghost.privacyStatus();
  syncWindow(state);
  $('#privacy-status').textContent = state.platform === 'darwin' ? 'Защита окна: ограничена на macOS · весь экран может показать помощника' : state.protectionRequested ? 'Защита окна включена · результат у зрителя не проверен' : 'Защита окна от захвата не поддерживается';
  $('#privacy').textContent = state.platform === 'darwin' ? 'macOS: защита включена, но ScreenCaptureKit может захватить окно. Универсальная невидимость не гарантируется. Передавайте отдельное окно другого приложения и проверьте результат у зрителя.' : state.protectionRequested ? 'Защита от захвата включена. Проверьте результат у зрителя.' : 'На этой ОС исключение из захвата не поддерживается.';
  $('#hide-window').textContent = state.shortcutRegistered ? 'Скрыть / вернуть · ⌘/Ctrl + Shift + H' : 'Скрыть окно · вернуть через значок приложения';
  const missing = Object.values(state.shortcuts || {}).filter(x => !x.registered).map(x => x.chord.replace('CommandOrControl', 'Cmd/Ctrl'));
  $('#shortcut-warning').hidden = !missing.length; $('#shortcut-warning').textContent = `Сочетания заняты: ${missing.join(', ')}. Используйте кнопки в окне.`;
}
function syncWindow(state) { pinned = state.pinned; $('#pin').setAttribute('aria-pressed', String(pinned)); $('#pin').textContent = pinned ? '↗ Закреплено' : '↗ Поверх окон'; $('#click-through').setAttribute('aria-pressed', String(Boolean(state.clickThrough))); $('#click-through').textContent = state.clickThrough ? 'Клики сквозь · ⌘⇧M' : 'Сквозь клики'; }
window.ghost.onWindowState(syncWindow);
$('#hide-stop').onclick = () => window.ghost.hideStop();
window.ghost.onStop(() => { window.ghostSession?.stop(); showError(''); });
loadProvider();
$('#provider').onchange = () => { if (window.ghostSession?.active()) window.ghostSession.stop(); loadProvider(); save('ghost.provider', $('#provider').value); updateStatus(); };
$('#hide-window').onclick = () => window.ghost.hide();
$('#context').oninput = () => { save('ghost.context', $('#context').value); $('#context-status').textContent = 'Сохранено на этом устройстве'; };
$('#custom-prompt').oninput = () => save('ghost.prompt', $('#custom-prompt').value);
$('#settings-open').onclick = () => $('#settings').showModal();
$('#settings-close').onclick = () => { $('#api-key').value = ''; $('#settings').close(); };
$('#settings').addEventListener('cancel', () => { $('#api-key').value = ''; });
async function saveSettings() {
  if ($('#api-key').value.trim()) await window.ghost.setKey($('#provider').value, $('#api-key').value);
  $('#api-key').value = ''; save(`ghost.model.${$('#provider').value}`, $('#model').value.trim()); save('ghost.provider', $('#provider').value); await updateStatus();
}
$('#settings-form').onsubmit = async event => { event.preventDefault(); try { await saveSettings(); $('#settings').close(); } catch (error) { $('#settings-error').textContent = error.message; } };
$('#test-key').onclick = async () => {
  $('#test-key').disabled = true; $('#settings-error').textContent = 'Проверяем Gemini…';
  try { if ($('#provider').value !== 'gemini') throw Error('Выберите Google Gemini.'); await saveSettings(); const result = await window.ghost.testKey($('#model').value.trim()); if (result.error) throw Error(result.error); $('#settings-error').textContent = `Подключение работает · ${(result.elapsedMs / 1000).toFixed(2)} с`; }
  catch (error) { $('#settings-error').textContent = error.message; }
  finally { $('#test-key').disabled = false; }
};
$('#forget-key').onclick = async () => { await window.ghost.setKey($('#provider').value, ''); $('#api-key').value = ''; await updateStatus(); };
$('#test-live').onclick = async () => {
  const button = $('#test-live'); button.disabled = true;
  $('#settings-error').textContent = 'Проверяем доступ к Live · без передачи аудио…';
  try {
    if ($('#provider').value !== 'gemini') throw Error('Для Live выберите Gemini.');
    if ($('#api-key').value.trim()) { await window.ghost.setKey('gemini', $('#api-key').value.trim()); $('#api-key').value = ''; await updateStatus(); }
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
window.ghost.onDelta(({ text }) => { if (!busy) return; streamingText += text; showAnswer(streamingText, true); $('#timing').textContent = 'Генерация…'; });
$('#cancel-answer').onclick = () => window.ghost.cancel();
$('#remove-snapshot').onclick = () => { pendingImage = null; $('#snapshot-preview').hidden = true; $('#snapshot-image').removeAttribute('src'); };
async function ask(question) {
  if (busy) return;
  if (!question.trim() && !pendingImage) { showError('Введите вопрос или дождитесь распознавания речи.'); return; }
  const submittedDraft = $('#question').value;
  busy = true; streamingText = ''; $('#submit').disabled = true; $('#cancel-answer').hidden = false; $('.answer-card').setAttribute('aria-busy', 'true'); showError('');
  navigation();
  try {
    await window.ghostSession?.cancelAnswer();
    const request = config();
    if (!request.model || !(await window.ghost.keyStatus(request.provider))) { $('#settings').showModal(); return; }
    question = question.trim() || 'Разбери задачу на снимке. Объясни решение и его сложность. Если текст неразборчив, скажи об этом.';
    $('#answer-question').textContent = question;
    const result = await window.ghost.generate({ ...request, question, ...(pendingImage ? { image: pendingImage } : {}) });
    if (result.error) throw Error(result.error);
    presentResult(result, question); $('#connection').textContent = `${result.provider} · запрос выполнен`;
    if ($('#question').value === submittedDraft && submittedDraft.trim() === question) {
      $('#question').value = ''; syncedQuestion = '';
      $('#question-origin').textContent = 'Введите следующий вопрос или продолжайте говорить';
      $('#use-heard').hidden = true;
    }
  } catch (error) { showError(error.message); }
  finally { busy = false; $('#submit').disabled = false; $('#cancel-answer').hidden = true; $('.answer-card').setAttribute('aria-busy', 'false'); navigation(); }
}
$('#question-form').onsubmit = event => { event.preventDefault(); ask($('#question').value); };
$('#question').onkeydown = event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $('#question-form').requestSubmit(); } };
$('#import-context').onclick = async () => { try { const result = await window.ghost.importContext(); if (result.error) throw Error(result.error); if (result.text !== undefined) { $('#context').value = result.text; $('#context').dispatchEvent(new Event('input')); } } catch (error) { showError(error.message); } };
window.copilot = { config, presentResult, receiveQuestion, followLive, beginSpeechAnswer, speechDelta, endSpeechAnswer, showError, ask, compact, busy: () => busy, setImage(image, name) { pendingImage = image; $('#snapshot-image').src = `data:${image.mimeType};base64,${image.data}`; $('#snapshot-name').textContent = name; $('#snapshot-preview').hidden = false; } };
renderHistory(); updateStatus(); updatePrivacy();
