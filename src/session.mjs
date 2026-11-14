import { rememberDialogueTurn, selectDialogue } from './dialogue.mjs';
import { SpeechSegments } from './audio.mjs';
import { captureError } from './capture.mjs';
import { joinSpeech, PcmPackets, QuestionTurns, vocabulary } from './speech.mjs';
const $ = s => document.querySelector(s);
let running = false, starting = false, stream, audioContext, worklet, input, segments, queue = [], processing = false, epoch = 0, timer, started = 0;
let transcript = [], answeredTurns = [], lastQuestion = '', selectedScreen = null;
let assembling, settleTimer, dispatchTimer, lastInterimAt = 0;
let preamble = [];
let manualRequestTimer;
const readyQuestions = [];
const questionPauseMs = 2800;
const speechPauseMs = 1350;
let monitorOnly = false, live = false, pcmPackets, frameRate = 0, voiceId = 0, lastVoiceAt = 0, speechStartedAt = 0;
let turns = new QuestionTurns(), sessionConfig, sessionVocabulary = [];
let latestMetrics = null;
let inFlightQuestion = '';
const answerMode = $('#answer-mode');
answerMode.value = localStorage.getItem('hidden.answerMode') === 'manual' ? 'manual' : 'auto';
answerMode.onchange = () => {
  localStorage.setItem('hidden.answerMode', answerMode.value);
  clearManualRequest();
  if (answerMode.value === 'manual') {
    readyQuestions.length = 0;
    clearTimeout(dispatchTimer);
    if (inFlightQuestion) {
      cancelAnswer();
      metrics({ waiting: false });
    }
  }
  if (running && !monitorOnly) status(answerMode.value === 'manual'
    ? 'Ручной режим · ответ только по кнопке или сочетанию клавиш'
    : 'Автоматический режим · отвечаем на распознанные вопросы');
};
function setLastQuestion(question) {
  lastQuestion = question;
  for (const id of ['answer-last', 'answer-heard']) $('#' + id).disabled = !question;
}
setLastQuestion('');
const storedSource = localStorage.getItem('hidden.audioSource');
if (storedSource === 'system') $('#audio-source').value = 'system';
function sourceButtons() { for (const name of ['microphone','system']) { $('#source-' + name).setAttribute('aria-pressed', String($('#audio-source').value === name)); $('#source-' + name).disabled = $('#audio-source').disabled; } }
for (const name of ['microphone','system']) $('#source-' + name).onclick = () => { if ($('#audio-source').disabled || running || starting) return; $('#audio-source').value = name; localStorage.setItem('hidden.audioSource', name); sourceButtons(); };
sourceButtons();
let nativeRate = 0;
function updateMeter(rms) {
  $('#audio-level').value = Math.min(1, Math.max(rms * 8, $('#audio-level').value * 0.9));
  if (monitorOnly && rms > 0.001) status('Звук получен ✓ · локальная проверка, без отправки в API.');
}
window.ghost.onNativeAudio(packet => {
  if (!running) return;
  if (packet.diagnostic) { if (monitorOnly) status(packet.diagnostic + ' · ожидаем звуковой сигнал, без отправки в API.'); return; }
  const binary = atob(packet.data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.byteLength % 4) return;
  consumeAudioFrame(new Float32Array(bytes.buffer), packet.sampleRate);
});
window.ghost.onNativeAudioError(async error => { if (running) { await stop(); ui.showError(error); } });
const ui = window.copilot;
const status = text => { $('#session-status').textContent = text; };
function base64(buffer) { let text = ''; for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte); return btoa(text); }
function rememberAnswer(question, answer) {
  rememberDialogueTurn(answeredTurns, question, answer);
}
function recentSpeech() { return transcript.map(turn => turn.text).join('\n').slice(-2400); }
function conversation() {
  const speech = recentSpeech();
  const recent = [];
  let budget = 9400;
  for (const turn of answeredTurns.slice().reverse()) {
    const pair = `Вопрос: ${turn.question}\nОтвет Hidden: ${turn.answer}`;
    if (pair.length + 2 > budget) break;
    recent.unshift(pair);
    budget -= pair.length + 2;
  }
  return ['Недавняя речь:\n' + speech, recent.length && 'Предыдущие вопросы и ответы:\n' + recent.join('\n\n')].filter(Boolean).join('\n\n');
}
function appendTranscript(textValue) {
  transcript.push({ text: textValue }); transcript = transcript.slice(-40);
  const row = document.createElement('div'); row.className = 'transcript-row';
  const time = document.createElement('span'); time.className = 'muted small'; time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('p'); text.textContent = textValue; row.append(time, text);
  if (!$('#transcript .transcript-row')) $('#transcript').replaceChildren();
  $('#transcript').append(row); while ($('#transcript').children.length > 40) $('#transcript').firstChild.remove(); $('#transcript').scrollTop = $('#transcript').scrollHeight;
  return row;
}
function heard(text, interim = false) {
  $('#heard-speech').hidden = false;
  $('#heard-speech').textContent = `${interim ? 'Слышу…' : 'Услышано:'} ${text}`;
}
function metrics(values) {
  latestMetrics = { ...latestMetrics, ...values };
  const sec = value => (Math.max(0, value) / 1000).toFixed(2) + ' с';
  $('#speech-metrics').textContent = [latestMetrics.mode,
    latestMetrics.transcriptionMs != null ? 'распознавание после речи ' + sec(latestMetrics.transcriptionMs) : '',
    latestMetrics.firstWordsMs != null ? 'первые слова после речи ' + sec(latestMetrics.firstWordsMs) : '',
    latestMetrics.totalMs != null ? 'весь ответ ' + sec(latestMetrics.totalMs) : '',
    latestMetrics.waiting ? 'Ответ задерживается · запрос продолжается' : ''
  ].filter(Boolean).join(' · ');
}
function scheduleQuestion() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settleQuestion, questionPauseMs);
}
function settleQuestion() {
  if (!running || !assembling) return;
  // Transcription boundaries are not conversation boundaries.
  const latestSpeech = live ? lastInterimAt : lastVoiceAt;
  if (processing || queue.length || performance.now() - latestSpeech < questionPauseMs) {
    settleTimer = setTimeout(settleQuestion, 150);
    return;
  }
  finishQuestion();
}
function finishQuestion() {
  const question = assembling;
  assembling = null;
  const button = document.createElement('button');
  button.className = 'text-button';
  button.textContent = '↗ ' + question.question;
  button.onclick = () => ui.ask(question.question, { image: null, heard: true });
  question.row.append(button);
  if (answerMode.value === 'auto') {
    readyQuestions.push(question);
    dispatchQuestions();
  } else if (manualRequestTimer) {
    clearManualRequest();
    ui.ask(question.question, { image: null, heard: true });
  } else {
    status('Вопрос готов · нажмите «Ответить на услышанное»');
  }
}
function dispatchQuestions() {
  clearTimeout(dispatchTimer);
  if (!running || answerMode.value !== 'auto' || !readyQuestions.length || inFlightQuestion) return;
  if (ui.busy()) {
    dispatchTimer = setTimeout(dispatchQuestions, 150);
    return;
  }
  generateSpeechAnswer(readyQuestions.shift());
}
export function acceptTranscript(raw, endedAt, transcriptionMs, beganAt = endedAt) {
  if (!running || monitorOnly || !raw.trim()) return;
  const result = turns.accept(raw, Date.now(), Boolean(lastQuestion || answeredTurns.length));
  heard(result.text);
  const questionKey = (result.question || result.text).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (questionKey && questionKey === inFlightQuestion) { status('Этот вопрос уже обрабатывается · ожидаем ответ'); return; }
  const row = appendTranscript(raw);
  if (result.corrections.length) {
    $('#speech-correction').hidden = false;
    $('#speech-correction').textContent = 'Понял как: ' + result.text + ' · ' + result.corrections.join(', ');
  } else $('#speech-correction').hidden = true;
  if (!result.question && (!assembling || turns.pending || beganAt - assembling.endedAt > questionPauseMs)) {
    if (!assembling && !turns.pending) {
      preamble = [...preamble.filter(part => endedAt - part.endedAt < 8000), { text: result.text, endedAt }].slice(-3);
    }
    if (assembling && turns.pending) scheduleQuestion();
    status('Фраза услышана · ожидаем вопрос или его продолжение');
    return;
  }
  const fragment = result.question || result.text;
  if (assembling && fragment === assembling.lastFragment) return;
  if (assembling && beganAt - assembling.endedAt > questionPauseMs) {
    finishQuestion();
  }
  const lead = preamble.filter(part => beganAt - part.endedAt <= questionPauseMs + 1800).map(part => part.text).join(' ').slice(-1800);
  const prefix = assembling?.question || lead;
  const question = prefix ? joinSpeech(prefix, fragment).slice(0, 12000) : fragment;
  preamble = [];
  assembling = { question, lastFragment: fragment, endedAt, transcriptionMs, row };
  setLastQuestion(question);
  ui.receiveQuestion(question);
  scheduleQuestion();
  status('Собираем вопрос · короткая пауза считается продолжением');
}
async function generateSpeechAnswer({ question, endedAt, transcriptionMs }) {
  const questionKey = question.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  metrics({ mode: live ? 'Live' : 'По фразам', transcriptionMs, firstWordsMs: null, totalMs: null, waiting: false });
  status('Вопрос понят · готовим ответ');
  voiceBeganAt = endedAt;
  const id = ++voiceId, sessionId = epoch;
  inFlightQuestion = questionKey;
  ui.beginSpeechAnswer(id, question);
  try {
    const answer = await window.ghost.speechAnswer({ ...ui.config(question, true), id, question });
    if (id !== voiceId || sessionId !== epoch || !running) return;
    if (answer.error) { metrics({ waiting: false }); ui.endSpeechAnswer(id, true); ui.showError(answer.error); status(answer.partialAnswer ? 'Получена часть ответа · можно повторить вопрос' : 'Ответ не получен · вопрос сохранён для повтора'); return; }
    metrics({ totalMs: performance.now() - endedAt });
    ui.endSpeechAnswer(id);
    ui.presentResult(answer, question, true);
    status('Ответ готов · продолжаем слушать');
  } catch { if (id === voiceId && sessionId === epoch) { ui.endSpeechAnswer(id); ui.showError('Не удалось получить голосовой ответ. Повторите вопрос.'); } }
  finally { if (id === voiceId) { inFlightQuestion = ''; dispatchQuestions(); } }
}
let voiceBeganAt = 0;
window.ghost.onSpeechDelta(packet => {
  if (!running || packet.id !== voiceId) return;
  ui.speechDelta(packet.id, packet.text);
  if (latestMetrics?.firstWordsMs == null) metrics({ firstWordsMs: performance.now() - voiceBeganAt, waiting: false });
  status('Ответ поступает · продолжаем слушать');
});
window.ghost.onSpeechNotice(packet => { if (running && packet.id === voiceId) { status(packet.message); metrics({ waiting: true }); } });
window.ghost.onLiveSpeech(event => {
  if (!running || !live || event.sessionId !== epoch) return;
  if (event.type === 'interim') { lastInterimAt = performance.now(); heard(event.text, true); }
  if (event.type === 'final') {
    lastInterimAt = 0;
    const endedAt = lastVoiceAt || performance.now();
    acceptTranscript(event.text, endedAt, performance.now() - endedAt, speechStartedAt || endedAt);
  }
  if (event.type === 'error') { ui.showError(event.message); stop(); }
});
export function consumeAudioFrame(frame, rate) {
  if (!running) return;
  if (!segments || frameRate !== rate) {
    frameRate = rate;
    segments = new SpeechSegments(rate, enqueue, { silenceMs: speechPauseMs });
    pcmPackets = new PcmPackets(rate, buffer => { if (running && live && !monitorOnly) window.ghost.sendSpeechPcm(base64(buffer)); });
  }
  const rms = segments.push(frame); updateMeter(rms);
  if (rms > segments.threshold) {
    const now = performance.now();
    if (!lastVoiceAt || now - lastVoiceAt >= speechPauseMs) speechStartedAt = now;
    lastVoiceAt = now;
  }
  if (live && !monitorOnly) pcmPackets.push(frame);
}
async function drain() {
  if (processing) return; processing = true;
  const drainEpoch = epoch;
  try {
    while (queue.length && running && drainEpoch === epoch) {
      const item = queue.shift(), sessionId = epoch;
      if (performance.now() - item.endedAt > 30000) { status('Ожидавшая фраза устарела · слушаем новый вопрос'); continue; }
      status('Распознаём фразу · ' + (queue.length ? 'следующая фраза ожидает' : 'без очереди'));
      const result = await window.ghost.transcribeAudio({ model: sessionConfig.recognitionModel, vocabulary: sessionVocabulary, audio: { data: base64(item.buffer), mimeType: 'audio/wav' } });
      if (sessionId !== epoch || !running) continue;
      if (result.error) { ui.showError(result.error); await stop(); return; }
      // Answer generation runs independently; transcription of the next phrase does not wait for it.
      acceptTranscript(result.transcript, item.endedAt, performance.now() - item.endedAt, item.beganAt);
    }
  } catch { if (drainEpoch === epoch) { ui.showError('Ошибка распознавания речи. Перезапустите слушание.'); await stop(); } }
  finally { processing = false; if (running && queue.length) drain(); }
}
function enqueue(buffer) {
  if (!running || monitorOnly) return;
  if (live) { pcmPackets?.flush(); window.ghost.endSpeechTurn(); return; }
  const endedAt = lastVoiceAt || performance.now();
  const item = { buffer, endedAt, beganAt: speechStartedAt || endedAt };
  if (queue.length >= 4) {
    queue[queue.length - 1] = item;
    status('Новая фраза заменила ожидающую · API занят');
  } else queue.push(item);
  drain();
}
let pickResolve;
async function chooseSource(forSnapshot = false) {
  if (pickResolve) return null;
  $('#sources').textContent = 'Получаем окна…'; $('#source-picker').showModal();
  const choice = new Promise(resolve => { pickResolve = resolve; });
  const request = pickResolve;
  try {
    const result = await window.ghost.sources(forSnapshot);
    if (pickResolve !== request) return choice;
    if (result.error) throw Error(result.error);
    $('#sources').replaceChildren();
    if (!result.sources.length) $('#sources').textContent = 'Нет доступных окон. Разрешите запись экрана в настройках ОС.';
    for (const source of result.sources) {
      const button = document.createElement('button'); button.className = 'source-item';
      const img = document.createElement('img'); img.src = source.thumbnail; img.alt = '';
      const title = document.createElement('span'); title.textContent = source.name; button.append(img, title);
      button.onclick = () => { const resolve = pickResolve; pickResolve = null; $('#source-picker').close(); resolve(source); };
      $('#sources').append(button);
    }
  } catch (error) { if (pickResolve === request) $('#sources').textContent = error.message; }
  return choice;
}
function cancelPicker() { if (pickResolve) { pickResolve(null); pickResolve = null; } }
$('#source-close').onclick = () => { cancelPicker(); $('#source-picker').close(); };
$('#source-picker').addEventListener('cancel', cancelPicker);
async function start(testOnly = false) {
  if (running || starting) return;
  starting = true; const id = ++epoch; $('#start-session').disabled = true;
  try {
    const cfg = ui.config();
    sessionConfig = cfg; sessionVocabulary = vocabulary(cfg.vocabulary, cfg.context);
    if (!testOnly && cfg.provider === 'openai') throw Error('Для голосовых ответов выберите Gemini или Groq.');
    if (!testOnly && !(await window.ghost.keyStatus('gemini'))) { $('#settings').showModal(); throw Error('Добавьте ключ Gemini для распознавания речи.'); }
    if (!testOnly && cfg.provider === 'groq' && !(await window.ghost.keyStatus('groq'))) { $('#settings').showModal(); throw Error('Добавьте ключ Groq для ответов.'); }
    if (!testOnly) { $('#heard-speech').hidden = false; $('#heard-speech').textContent = 'Открываем источник звука…'; }
    const kind = $('#audio-source').value;
    const diagnostics = await window.ghost.mediaDiagnostics();
    let source;
    if (kind === 'system' && !diagnostics.nativeAudio && !diagnostics.nativePicker) { source = await chooseSource(); if (!source) return; }
    await window.ghost.armMedia(kind);
    let nativeStarted = false;
    if (kind === 'system' && diagnostics.nativeAudio) {
      const result = await window.ghost.startNativeAudio();
      if (id !== epoch) return;
      nativeStarted = !result.error;
      if (nativeStarted) { segments = null; nativeRate = 0; }
    }
    if (!nativeStarted) {
    if (kind === 'system') { if (source) await window.ghost.selectSource(source.id); stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
    else stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (id !== epoch) { stream.getTracks().forEach(t => t.stop()); return; }
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') throw Error('Нет живого аудиотрека. Разрешите системный звук в настройках macOS для Electron или запускающего приложения.');
    track.onended = () => { if (running) { status('Источник звука отключён'); stop(); } };
    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule('audio-worklet.js');
    if (id !== epoch) return;
    segments = null; frameRate = 0;
    input = audioContext.createMediaStreamSource(new MediaStream([track]));
    worklet = new AudioWorkletNode(audioContext, 'ghost-audio');
    worklet.port.onmessage = event => consumeAudioFrame(event.data, audioContext.sampleRate);
    const mute = audioContext.createGain(); mute.gain.value = 0; input.connect(worklet).connect(mute).connect(audioContext.destination);
    await audioContext.resume();
    }
    let fallback = '';
    live = false;
    if (!testOnly && cfg.recognitionMode !== 'batch') {
      status('Подключаем потоковое распознавание…');
      $('#heard-speech').textContent = 'Подключаем Live · дождитесь начала слушания';
      const connection = await window.ghost.startLiveSpeech({ vocabulary: sessionVocabulary, sessionId: id });
      if (id !== epoch) return;
      if (connection.error) {
        if (cfg.recognitionMode === 'live') throw Error(connection.error);
        fallback = connection.error + ' Работаем по фразам.';
      } else live = true;
    }
    segments = null; frameRate = 0; pcmPackets = null; lastVoiceAt = 0; speechStartedAt = 0; lastInterimAt = 0; turns = new QuestionTurns(); latestMetrics = null;
    running = true; monitorOnly = testOnly; started = Date.now();
    ui.showError(''); $('#speech-correction').hidden = true;
    if (!testOnly) metrics({ mode: live ? 'Live · звук передаётся во время речи' : 'По фразам · отправка после паузы' });
    if (!testOnly) { ui.followLive(); $('#heard-speech').hidden = false; $('#heard-speech').textContent = 'Слушаем · ожидаем новую фразу'; }
    timer = setInterval(() => { const sec = Math.floor((Date.now() - started) / 1000); $('#session-time').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }, 1000);
    $('#stop-session').disabled = false; $('#flush-audio').disabled = testOnly; $('#audio-source').disabled = true; sourceButtons(); $('#check-sound').disabled = true; $('#live-dot').classList.add('listening');
    status(testOnly ? 'Проверка звука: только индикатор, без отправки аудио в API. Включите звук и проверьте уровень.' : (fallback || (live ? 'Live · распознаём во время речи' : 'Слушаем · распознаём после паузы')) + (answerMode.value === 'manual' ? ' · ответ по кнопке' : ''));
  } catch (error) { if (id !== epoch) return; const diagnostics = await window.ghost.mediaDiagnostics(); await stop(); ui.showError(captureError(error, $('#audio-source').value, diagnostics)); }
  finally { starting = false; $('#start-session').disabled = running; if (!running) { stream?.getTracks().forEach(t => t.stop()); if (audioContext && audioContext.state !== 'closed') await audioContext.close(); await window.ghost.armMedia(false); } }
}
async function stop() {
  if ($('#source-picker').open) { cancelPicker(); $('#source-picker').close(); }
  clearTimeout(settleTimer);
  clearTimeout(dispatchTimer);
  clearManualRequest();
  assembling = null;
  preamble = [];
  readyQuestions.length = 0;
  running = false; epoch++; voiceId++; inFlightQuestion = ''; ui.endSpeechAnswer(undefined, true); live = false; pcmPackets = null; frameRate = 0; queue = []; clearInterval(timer);
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null;
  if (worklet) { worklet.port.onmessage = null; worklet.disconnect(); } input?.disconnect();
  if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  worklet = null; input = null; audioContext = null; segments = null; nativeRate = 0;
  await window.ghost.armMedia(false);
  $('#start-session').disabled = false; $('#stop-session').disabled = true; $('#flush-audio').disabled = true; $('#audio-source').disabled = false; sourceButtons(); $('#live-dot').classList.remove('listening'); $('#audio-level').value = 0;
  $('#check-sound').disabled = false; monitorOnly = false;
  status('Сессия остановлена · аудио больше не передаётся');
}
let capturingScreen = false;
async function snapshot({ choose = false, analyze = true } = {}) {
  if (capturingScreen || ui.busy() || $('#settings').open) return;
  capturingScreen = true;
  const captureEpoch = epoch;
  try {
    const provider = ui.screenProvider();
    if (analyze && !(await window.ghost.keyStatus(provider))) {
      $('#settings').showModal();
      throw Error(`Добавьте ключ ${provider === 'groq' ? 'Groq' : 'Gemini'} для анализа экрана.`);
    }
    const source = !choose && selectedScreen ? selectedScreen : await chooseSource(true);
    if (!source || captureEpoch !== epoch || $('#settings').open) return;
    selectedScreen = source;
    $('#screen-source-name').textContent = source.name;
    const mode = ui.screenMode();
    const result = await window.ghost.snapshot(source.id, mode === 'groq');
    if (captureEpoch !== epoch || $('#settings').open || mode !== ui.screenMode()) return;
    if (result.error) {
      if (result.sourceUnavailable) {
        selectedScreen = null;
        $('#screen-source-name').textContent = '';
      }
      throw Error(result.error);
    }
    const image = { ...result.image, screenText: result.screenText };
    ui.setImage(image, result.name);
    if (analyze) {
      await ui.ask('', { image, preserveDraft: true, title: 'Задача с экрана · ' + result.name });
    } else {
      $('#snapshot-preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (error) { ui.showError(error.message); }
  finally { capturingScreen = false; }
}
$('#start-session').onclick = () => start(); $('#check-sound').onclick = () => start(true); $('#stop-session').onclick = stop;
$('#flush-audio').onclick = () => { const emitted = segments?.flush(); if (live && !emitted) { pcmPackets?.flush(); window.ghost.endSpeechTurn(); } };
$('#capture-screen').onclick = () => snapshot();
$('#change-screen-source').onclick = () => snapshot({ choose: true, analyze: false });
$('#preview-screen').onclick = () => snapshot({ analyze: false });
$('#compact-snapshot').onclick = () => snapshot();
function clearManualRequest() {
  clearTimeout(manualRequestTimer);
  manualRequestTimer = undefined;
}
function answerLast() {
  if ($('#settings').open || $('#source-picker').open) return;
  if (ui.busy() || manualRequestTimer) return;
  if (running && answerMode.value === 'manual' && (lastInterimAt || processing || queue.length || turns.pending)) {
    manualRequestTimer = setTimeout(() => {
      clearManualRequest();
      status('Не удалось завершить распознавание · повторите команду после фразы');
    }, 15000);
    status('Заканчиваем распознавание · ответ появится после фразы');
    $('#flush-audio').click();
    return;
  }
  if (!lastQuestion) { ui.showError('Вопрос ещё не распознан. Начните слушать.'); return; }
  if (assembling && answerMode.value === 'manual') {
    clearTimeout(settleTimer);
    finishQuestion();
  } else if (assembling) {
    clearTimeout(settleTimer);
    assembling = null;
  }
  return ui.ask(lastQuestion, { image: null, heard: true });
}
$('#answer-last').onclick = answerLast;
$('#answer-heard').onclick = answerLast;
$('#clear-transcript').onclick = () => { if (running || processing) { ui.showError('Остановите сессию перед очисткой диалога.'); return; } transcript = []; answeredTurns = []; setLastQuestion(''); $('#transcript').textContent = 'Диалог очищен.'; };
window.ghost.onAnswerLast(answerLast); window.ghost.onSnapshot(() => snapshot());
function cancelAnswer() {
  voiceId++;
  inFlightQuestion = '';
  ui.endSpeechAnswer(undefined, true);
  return window.ghost.cancelSpeechAnswer();
}
window.ghostSession = { conversation, recentSpeech, rememberAnswer, dialogue: question => selectDialogue(answeredTurns, question), active: () => running || starting, stop, metrics: () => latestMetrics, cancelAnswer };
window.addEventListener('beforeunload', () => { stream?.getTracks().forEach(t => t.stop()); window.ghost.armMedia(false); });
