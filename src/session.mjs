import { SpeechSegments } from './audio.mjs';
import { captureError } from './capture.mjs';
import { PcmPackets, QuestionTurns, vocabulary } from './speech.mjs';
const $ = s => document.querySelector(s);
let running = false, starting = false, stream, audioContext, worklet, input, segments, queue = [], processing = false, epoch = 0, timer, started = 0;
let transcript = [], lastQuestion = '', selectedScreen = null;
let monitorOnly = false, live = false, pcmPackets, frameRate = 0, voiceId = 0, lastVoiceAt = 0;
let turns = new QuestionTurns(), sessionConfig, sessionVocabulary = [];
let latestMetrics = null;
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
function conversation() { return transcript.map(x => `${x.text}${x.question ? `\nВопрос: ${x.question}` : ''}${x.answer ? `\nУже дан ответ: ${x.answer}` : ''}`).join('\n').slice(-12000); }
function appendTranscript(item) {
  if (item.question) { lastQuestion = item.question; ui.receiveQuestion(item.question); }
  if (!item.transcript) return;
  const stored = { text: item.transcript, question: item.question, answer: item.answer }; transcript.push(stored); transcript = transcript.slice(-40);
  const row = document.createElement('div'); row.className = 'transcript-row';
  const time = document.createElement('span'); time.className = 'muted small'; time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('p'); text.textContent = item.transcript; row.append(time, text);
  if (item.question) { const button = document.createElement('button'); button.className = 'text-button'; button.textContent = `↗ ${item.question}`; button.onclick = () => ui.ask(item.question); row.append(button); }
  if (!$('#transcript .transcript-row')) $('#transcript').replaceChildren();
  $('#transcript').append(row); while ($('#transcript').children.length > 40) $('#transcript').firstChild.remove(); $('#transcript').scrollTop = $('#transcript').scrollHeight;
  return stored;
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
    latestMetrics.totalMs != null ? 'весь ответ ' + sec(latestMetrics.totalMs) : ''
  ].filter(Boolean).join(' · ');
}
async function acceptTranscript(raw, endedAt, transcriptionMs) {
  if (!running || monitorOnly || !raw.trim()) return;
  const result = turns.accept(raw);
  heard(result.text);
  const entry = appendTranscript({ transcript: raw, question: result.question, answer: '' });
  if (result.corrections.length) {
    $('#speech-correction').hidden = false;
    $('#speech-correction').textContent = 'Понял как: ' + result.text + ' · ' + result.corrections.join(', ');
  } else $('#speech-correction').hidden = true;
  if (!result.question) { status('Фраза услышана · ожидаем вопрос или его продолжение'); return; }
  metrics({ mode: live ? 'Live' : 'По фразам', transcriptionMs, firstWordsMs: null, totalMs: null });
  status('Вопрос понят · готовим ответ');
  if (!$('#auto-answer').checked) { status('Вопрос распознан · автоответ выключен'); return; }
  voiceBeganAt = endedAt;
  const id = ++voiceId, sessionId = epoch;
  ui.beginSpeechAnswer(id, result.question);
  const slow = setTimeout(() => { if (id === voiceId && running && latestMetrics?.firstWordsMs == null) status('Gemini задерживается · ответ появится по мере получения'); }, 5000);
  try {
    const answer = await window.ghost.speechAnswer({ ...ui.config(), id, question: result.question });
    if (id !== voiceId || sessionId !== epoch || !running) return;
    if (answer.error) { ui.endSpeechAnswer(id); ui.showError(answer.error); status('Ответ не получен · можно повторить последний вопрос'); return; }
    entry.answer = answer.answer;
    metrics({ totalMs: performance.now() - endedAt });
    ui.endSpeechAnswer(id);
    ui.presentResult(answer, result.question, true);
    status('Ответ готов · продолжаем слушать');
  } catch { if (id === voiceId && sessionId === epoch) { ui.endSpeechAnswer(id); ui.showError('Не удалось получить голосовой ответ. Повторите вопрос.'); } }
  finally { clearTimeout(slow); }
}
let voiceBeganAt = 0;
window.ghost.onSpeechDelta(packet => {
  if (!running || packet.id !== voiceId) return;
  ui.speechDelta(packet.id, packet.text);
  if (latestMetrics?.firstWordsMs == null) metrics({ firstWordsMs: performance.now() - voiceBeganAt });
  status('Ответ поступает · продолжаем слушать');
});
window.ghost.onLiveSpeech(event => {
  if (!running || !live || event.sessionId !== epoch) return;
  if (event.type === 'interim') heard(event.text, true);
  if (event.type === 'final') {
    const endedAt = lastVoiceAt || performance.now();
    acceptTranscript(event.text, endedAt, performance.now() - endedAt);
  }
  if (event.type === 'error') { ui.showError(event.message); stop(); }
});
export function consumeAudioFrame(frame, rate) {
  if (!running) return;
  if (!segments || frameRate !== rate) {
    frameRate = rate;
    segments = new SpeechSegments(rate, enqueue, { silenceMs: 650 });
    pcmPackets = new PcmPackets(rate, buffer => { if (running && live && !monitorOnly) window.ghost.sendSpeechPcm(base64(buffer)); });
  }
  const rms = segments.push(frame); updateMeter(rms);
  if (rms > segments.threshold) lastVoiceAt = performance.now();
  if (live && !monitorOnly) pcmPackets.push(frame);
}
async function drain() {
  if (processing) return; processing = true;
  const drainEpoch = epoch;
  try {
    while (queue.length && running && drainEpoch === epoch) {
      const item = queue.shift(), sessionId = epoch;
      if (performance.now() - item.endedAt > 8000) { status('Ожидавшая фраза устарела · слушаем новый вопрос'); continue; }
      status('Распознаём фразу · ' + (queue.length ? 'следующая фраза ожидает' : 'без очереди'));
      const result = await window.ghost.transcribeAudio({ model: sessionConfig.model, vocabulary: sessionVocabulary, audio: { data: base64(item.buffer), mimeType: 'audio/wav' } });
      if (sessionId !== epoch || !running) continue;
      if (result.error) { ui.showError(result.error); await stop(); return; }
      // Answer generation runs independently; transcription of the next phrase does not wait for it.
      acceptTranscript(result.transcript, item.endedAt, performance.now() - item.endedAt);
    }
  } catch { if (drainEpoch === epoch) { ui.showError('Ошибка распознавания речи. Перезапустите слушание.'); await stop(); } }
  finally { processing = false; if (running && queue.length) drain(); }
}
function enqueue(buffer) {
  if (!running || monitorOnly) return;
  if (live) { pcmPackets?.flush(); window.ghost.endSpeechTurn(); return; }
  if (queue.length >= 1) { queue[0] = { buffer, endedAt: lastVoiceAt || performance.now() }; status('Новая фраза заменила ожидающую · API занят'); }
  else queue.push({ buffer, endedAt: lastVoiceAt || performance.now() });
  drain();
}
let pickResolve;
async function chooseSource() {
  if (pickResolve) return null;
  $('#sources').textContent = 'Получаем окна…'; $('#source-picker').showModal();
  const choice = new Promise(resolve => { pickResolve = resolve; });
  try {
    const result = await window.ghost.sources();
    if (!pickResolve) return null;
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
  } catch (error) { $('#sources').textContent = error.message; }
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
    if (!testOnly && cfg.provider !== 'gemini') throw Error('Для аудиосессии выберите Gemini в настройках.');
    if (!testOnly && !(await window.ghost.keyStatus('gemini'))) { $('#settings').showModal(); return; }
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
    segments = null; frameRate = 0; pcmPackets = null; lastVoiceAt = 0; turns = new QuestionTurns(); latestMetrics = null;
    running = true; monitorOnly = testOnly; started = Date.now();
    ui.showError(''); $('#speech-correction').hidden = true;
    if (!testOnly) metrics({ mode: live ? 'Live · звук передаётся во время речи' : 'По фразам · отправка после паузы' });
    if (!testOnly) { ui.followLive(); $('#heard-speech').hidden = false; $('#heard-speech').textContent = 'Слушаем · ожидаем новую фразу'; }
    timer = setInterval(() => { const sec = Math.floor((Date.now() - started) / 1000); $('#session-time').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }, 1000);
    $('#stop-session').disabled = false; $('#flush-audio').disabled = testOnly; $('#audio-source').disabled = true; sourceButtons(); $('#check-sound').disabled = true; $('#live-dot').classList.add('listening');
    status(testOnly ? 'Проверка звука: только индикатор, без отправки аудио в API. Включите звук и проверьте уровень.' : fallback || (live ? 'Live · распознаём во время речи' : 'Слушаем · распознаём после паузы'));
  } catch (error) { if (id !== epoch) return; const diagnostics = await window.ghost.mediaDiagnostics(); await stop(); ui.showError(captureError(error, $('#audio-source').value, diagnostics)); }
  finally { starting = false; $('#start-session').disabled = running; if (!running) { stream?.getTracks().forEach(t => t.stop()); if (audioContext && audioContext.state !== 'closed') await audioContext.close(); await window.ghost.armMedia(false); } }
}
async function stop() {
  running = false; epoch++; voiceId++; ui.endSpeechAnswer(); live = false; pcmPackets = null; frameRate = 0; queue = []; clearInterval(timer);
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null;
  if (worklet) { worklet.port.onmessage = null; worklet.disconnect(); } input?.disconnect();
  if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  worklet = null; input = null; audioContext = null; segments = null; nativeRate = 0;
  await window.ghost.armMedia(false);
  $('#start-session').disabled = false; $('#stop-session').disabled = true; $('#flush-audio').disabled = true; $('#audio-source').disabled = false; sourceButtons(); $('#live-dot').classList.remove('listening'); $('#audio-level').value = 0;
  $('#check-sound').disabled = false; monitorOnly = false;
  status('Сессия остановлена · аудио больше не передаётся');
}
async function snapshot(reuse = false) {
  try {
    if (ui.config().provider !== 'gemini') throw Error('Для анализа экрана выберите Gemini.');
    const source = reuse && selectedScreen ? selectedScreen : await chooseSource(); if (!source) return;
    selectedScreen = source;
    const result = await window.ghost.snapshot(source.id); if (result.error) { selectedScreen = null; throw Error(result.error); }
    ui.setImage(result.image, result.name);
    $('#snapshot-preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { ui.showError(error.message); }
}
$('#start-session').onclick = () => start(); $('#check-sound').onclick = () => start(true); $('#stop-session').onclick = stop;
$('#flush-audio').onclick = () => { const emitted = segments?.flush(); if (live && !emitted) { pcmPackets?.flush(); window.ghost.endSpeechTurn(); } };
$('#capture-screen').onclick = () => snapshot();
$('#compact-snapshot').onclick = () => snapshot(true);
$('#answer-last').onclick = () => lastQuestion ? ui.ask(lastQuestion) : ui.showError('Вопрос ещё не распознан. Начните сессию или введите вопрос.');
$('#clear-transcript').onclick = () => { if (running || processing) { ui.showError('Остановите сессию перед очисткой диалога.'); return; } transcript = []; lastQuestion = ''; $('#transcript').textContent = 'Диалог очищен.'; };
window.ghost.onAnswerLast(() => $('#answer-last').click()); window.ghost.onSnapshot(() => snapshot(true));
window.ghostSession = { conversation, active: () => running || starting, stop, metrics: () => latestMetrics };
window.addEventListener('beforeunload', () => { stream?.getTracks().forEach(t => t.stop()); window.ghost.armMedia(false); });
