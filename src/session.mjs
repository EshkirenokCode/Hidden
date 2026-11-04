import { SpeechSegments } from './audio.mjs';
import { captureError } from './capture.mjs';
const $ = s => document.querySelector(s);
let running = false, starting = false, stream, audioContext, worklet, input, segments, queue = [], processing = false, epoch = 0, timer, started = 0;
let transcript = [], lastQuestion = '', selectedScreen = null;
let monitorOnly = false;
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
  if (!segments || nativeRate !== packet.sampleRate) { nativeRate = packet.sampleRate; segments = new SpeechSegments(nativeRate, enqueue); }
  const binary = atob(packet.data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.byteLength % 4) return;
  updateMeter(segments.push(new Float32Array(bytes.buffer)));
});
window.ghost.onNativeAudioError(async error => { if (running) { await stop(); ui.showError(error); } });
const ui = window.copilot;
const status = text => { $('#session-status').textContent = text; };
function base64(buffer) { let text = ''; for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte); return btoa(text); }
function conversation() { return transcript.map(x => `${x.text}${x.question ? `\nВопрос: ${x.question}` : ''}${x.answer ? `\nУже дан ответ: ${x.answer}` : ''}`).join('\n').slice(-12000); }
function appendTranscript(item) {
  if (item.question) { lastQuestion = item.question; ui.receiveQuestion(item.question); }
  if (!item.transcript) return;
  transcript.push({ text: item.transcript, question: item.question, answer: item.answer }); transcript = transcript.slice(-40);
  const row = document.createElement('div'); row.className = 'transcript-row';
  const time = document.createElement('span'); time.className = 'muted small'; time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('p'); text.textContent = item.transcript; row.append(time, text);
  if (item.question) { const button = document.createElement('button'); button.className = 'text-button'; button.textContent = `↗ ${item.question}`; button.onclick = () => ui.ask(item.question); row.append(button); }
  if (!$('#transcript .transcript-row')) $('#transcript').replaceChildren();
  $('#transcript').append(row); while ($('#transcript').children.length > 40) $('#transcript').firstChild.remove(); $('#transcript').scrollTop = $('#transcript').scrollHeight;
}
async function drain() {
  if (processing) return; processing = true;
  try {
    while (queue.length && running) {
      const item = queue.shift(), id = epoch, cfg = ui.config(); status(`Распознаём фразу · в очереди ${queue.length}`);
      const result = await window.ghost.analyzeAudio({ model: cfg.model, context: cfg.context, customPrompt: cfg.customPrompt, conversation: conversation(), audio: { data: base64(item), mimeType: 'audio/wav' }, autoAnswer: $('#auto-answer').checked });
      if (id !== epoch || !running) continue;
      if (result.error) { ui.showError(result.error); await stop(); return; }
      appendTranscript(result);
      if (result.transcript) { $('#heard-speech').hidden = false; $('#heard-speech').textContent = `Услышано: ${result.transcript}`; }
      if (result.question && result.answer) ui.presentResult({ ...result, model: cfg.model }, result.question, true);
      status(result.question ? `Вопрос распознан · ${(result.elapsedMs / 1000).toFixed(2)} с` : 'Слушаем · вопрос пока не определён');
    }
  } catch (error) { ui.showError(error.message); await stop(); }
  finally { processing = false; if (running && queue.length) drain(); }
}
function enqueue(buffer) {
  if (!running || monitorOnly) return;
  if (queue.length >= 3) { ui.showError('API не успевает обрабатывать звук. Сессия остановлена; уменьшите нагрузку или выберите другую модель.'); stop(); return; }
  queue.push(buffer); drain();
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
  if (running || starting || processing) return;
  starting = true; const id = ++epoch; $('#start-session').disabled = true;
  try {
    const cfg = ui.config();
    if (!testOnly && cfg.provider !== 'gemini') throw Error('Для аудиосессии выберите Gemini в настройках.');
    if (!testOnly && !(await window.ghost.keyStatus('gemini'))) { $('#settings').showModal(); return; }
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
    segments = new SpeechSegments(audioContext.sampleRate, enqueue);
    input = audioContext.createMediaStreamSource(new MediaStream([track]));
    worklet = new AudioWorkletNode(audioContext, 'ghost-audio');
    worklet.port.onmessage = event => { if (!running) return; updateMeter(segments.push(event.data)); };
    const mute = audioContext.createGain(); mute.gain.value = 0; input.connect(worklet).connect(mute).connect(audioContext.destination);
    await audioContext.resume();
    }
    running = true; monitorOnly = testOnly; started = Date.now();
    if (!testOnly) { ui.followLive(); $('#heard-speech').hidden = false; $('#heard-speech').textContent = 'Слушаем · ожидаем новую фразу'; }
    timer = setInterval(() => { const sec = Math.floor((Date.now() - started) / 1000); $('#session-time').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }, 1000);
    $('#stop-session').disabled = false; $('#flush-audio').disabled = testOnly; $('#audio-source').disabled = true; sourceButtons(); $('#check-sound').disabled = true; $('#live-dot').classList.add('listening');
    status(testOnly ? 'Проверка звука: только индикатор, без отправки аудио в API. Включите звук и проверьте уровень.' : kind === 'system' ? 'Слушаем системный звук · проверьте индикатор уровня' : 'Слушаем микрофон · после паузы фраза уйдёт в Gemini');
  } catch (error) { if (id !== epoch) return; const diagnostics = await window.ghost.mediaDiagnostics(); await stop(); ui.showError(captureError(error, $('#audio-source').value, diagnostics)); }
  finally { starting = false; $('#start-session').disabled = running; if (!running) { stream?.getTracks().forEach(t => t.stop()); if (audioContext && audioContext.state !== 'closed') await audioContext.close(); await window.ghost.armMedia(false); } }
}
async function stop() {
  running = false; epoch++; queue = []; clearInterval(timer);
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
$('#flush-audio').onclick = () => segments?.flush();
$('#capture-screen').onclick = () => snapshot();
$('#compact-snapshot').onclick = () => snapshot(true);
$('#answer-last').onclick = () => lastQuestion ? ui.ask(lastQuestion) : ui.showError('Вопрос ещё не распознан. Начните сессию или введите вопрос.');
$('#clear-transcript').onclick = () => { if (running || processing) { ui.showError('Остановите сессию перед очисткой диалога.'); return; } transcript = []; lastQuestion = ''; $('#transcript').textContent = 'Диалог очищен.'; };
window.ghost.onAnswerLast(() => $('#answer-last').click()); window.ghost.onSnapshot(() => snapshot(true));
window.ghostSession = { conversation, active: () => running || starting, stop };
window.addEventListener('beforeunload', () => { stream?.getTracks().forEach(t => t.stop()); window.ghost.armMedia(false); });
