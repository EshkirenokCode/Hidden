const { app, BrowserWindow, ipcMain, session, globalShortcut, desktopCapturer, nativeImage, dialog, systemPreferences, screen } = require('electron');
const { fitOverlay } = require('./overlay-layout.cjs');
const { allowMediaRequest } = require('./media-policy.cjs');
const { SystemAudio } = require('./system-audio.cjs');
const { LiveTranscriber } = require('./live-transcriber.cjs');
const { generateVoiceAnswer } = require('./voice-answer.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { generate } = require('./provider.cjs');
const { analyzeAudio, transcribeAudio, call } = require('./gemini.cjs');
const keys = { groq: process.env.GROQ_API_KEY || '', openai: process.env.OPENAI_API_KEY || '', gemini: process.env.GEMINI_API_KEY || '' };
// Preserve the development profile when changing the product name.
app.setPath('userData', path.join(app.getPath('appData'), 'ghost-workspace'));
app.setName('Hidden');
app.setAppUserModelId('com.eshkirenok.hidden');
const entry = pathToFileURL(path.join(__dirname, '../src/index.html')).href;
const smoke = process.argv.includes('--smoke-test');
if (smoke) {
  app.setPath('userData', path.join(require('node:os').tmpdir(), `ghost-smoke-${process.pid}`));
  keys.openai = ''; keys.gemini = ''; keys.groq = '';
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
}
let mainWindow, shortcutRegistered = false, mediaArmed = false, displaySource = null, captureMode = null;
let lastCaptureDenial = '';
const nativePicker = process.platform === 'darwin' && Number(process.getSystemVersion().split('.')[0]) >= 15 && !smoke;
let sourceIds = new Set();
let normalBounds;
let compactPinned = false;
let clickThrough = false;
const shortcuts = {};
const shortcutActions = {
  answer: () => mainWindow?.webContents.send('session:answer-last'),
  snapshot: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.webContents.send('session:snapshot');
  }
};
const customDefaults = { answer: 'CommandOrControl+Shift+Space', snapshot: 'CommandOrControl+Shift+S' };
const shortcutFile = () => path.join(app.getPath('userData'), 'shortcuts.json');
function validChord(chord) {
  return typeof chord === 'string' &&
    /^(?:CommandOrControl(?:\+Alt)?(?:\+Shift)?|Alt(?:\+Shift)?)\+(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Enter|Left|Right|Up|Down)$/.test(chord);
}
function registerShortcut(name, chord, action) {
  let registered = false;
  try { registered = globalShortcut.register(chord, action); } catch {}
  shortcuts[name] = { chord, registered };
}
function changeShortcuts(request) {
  const names = Object.keys(shortcutActions);
  const chords = names.map(name => request?.[name]);
  if (!chords.every(validChord)) throw Error('Укажите сочетания с Cmd/Ctrl или Alt.');
  const reserved = Object.keys(shortcuts).filter(name => !names.includes(name)).map(name => shortcuts[name].chord);
  if (new Set(chords).size !== chords.length || chords.some(chord => reserved.includes(chord))) {
    throw Error('Сочетания должны различаться и не совпадать с другими действиями Hidden.');
  }
  const changed = names.filter(name => request[name] !== shortcuts[name].chord || !shortcuts[name].registered);
  const previous = Object.fromEntries(changed.map(name => [name, shortcuts[name]]));
  function unregister(name) {
    if (shortcuts[name].registered) globalShortcut.unregister(shortcuts[name].chord);
  }
  for (const name of changed) unregister(name);
  try {
    for (const name of changed) {
      registerShortcut(name, request[name], shortcutActions[name]);
      if (!shortcuts[name].registered) throw Error(`Сочетание ${request[name]} занято системой или другим приложением.`);
    }
    if (changed.length) {
      const temp = shortcutFile() + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(names.map(name => [name, request[name]]))));
      fs.renameSync(temp, shortcutFile());
    }
  } catch (error) {
    for (const name of changed) {
      if (shortcuts[name] !== previous[name]) unregister(name);
    }
    for (const name of changed) registerShortcut(name, previous[name].chord, shortcutActions[name]);
    publishWindowState();
    throw error;
  }
  publishWindowState();
  return windowState();
}
const nativeAudioPath = app.isPackaged ? path.join(process.resourcesPath, 'hidden-system-audio') : path.join(__dirname, '../native/bin/hidden-system-audio');
let nativeAudio;
let liveTranscriber;
function stopSpeech() { liveTranscriber?.stop(); liveTranscriber = null; controllers.get('speech-answer')?.abort(); controllers.get('transcription')?.abort(); }
function windowState() { return { compact: Boolean(normalBounds), pinned: Boolean(mainWindow?.isAlwaysOnTop()), clickThrough, shortcuts }; }
function setClickThrough(enabled) { clickThrough = Boolean(enabled && normalBounds); mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true }); publishWindowState(); return clickThrough; }
function publishWindowState() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:state', windowState()); }
function hideAndStop() {
  setClickThrough(false);
  nativeAudio?.stop();
  stopSpeech();
  mediaArmed = false; captureMode = null; displaySource = null;
  for (const controller of controllers.values()) controller.abort();
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('session:stop'); mainWindow.hide(); }
}
const controllers = new Map();
function providerName(value) {
  if (!['openai', 'gemini', 'groq'].includes(value)) throw Error('Неизвестный провайдер.');
  return value;
}
function trusted(event) {
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== entry) throw Error('Недопустимый источник запроса.');
}
function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setClickThrough(false);
  if (mainWindow.isVisible()) mainWindow.hide(); else { mainWindow.show(); mainWindow.focus(); }
}
function fail(error) {
  return { error: error.name === 'TimeoutError' ? 'Время ожидания истекло.' : error.name === 'AbortError' ? 'Запрос отменён.' : error.message };
}
const fetchImpl = smoke ? require('../test/smoke-api.cjs') : fetch;
async function runTask(type, work) {
  if (controllers.has(type)) return { error: 'Дождитесь текущего запроса.' };
  const controller = new AbortController(); controllers.set(type, controller);
  const started = performance.now();
  try { return { ...await work(controller.signal), elapsedMs: Math.round(performance.now() - started) }; }
  catch (error) { return fail(error); }
  finally { if (controllers.get(type) === controller) controllers.delete(type); }
}
async function sources(thumbnailSize = { width: 320, height: 180 }) {
  if (smoke) {
    const thumbnail = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 });
    return [{ id: 'window:1:0', name: 'Smoke task window', thumbnail }];
  }
  const list = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize });
  return list.filter(s => s.name !== 'Hidden' && s.name !== 'Ghost · Interview workspace' && !s.name.startsWith('Ghost ·'));
}
function createWindow() {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, hasShadow: false, width: 1340, height: 900, minWidth: 900, minHeight: 680, backgroundColor: '#00000000', title: 'Hidden', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  mainWindow = win;
  normalBounds = null;
  if (['darwin', 'win32'].includes(process.platform)) win.setContentProtection(true);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('closed', () => { nativeAudio?.stop(); stopSpeech(); mediaArmed = false; captureMode = null; displaySource = null; for (const c of controllers.values()) c.abort(); });
  win.loadURL(entry);
  if (smoke) {
    win.webContents.once('did-finish-load', () => require('../test/smoke-runner.cjs')({ app, win, toggleWindow }));
    setTimeout(() => app.exit(1), 30000).unref();
  }
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const allowed = allowMediaRequest({ trusted: wc === mainWindow?.webContents && wc?.getURL() === entry && mediaArmed, mode: captureMode, permission, mediaTypes: details.mediaTypes || [], mainFrame: details.isMainFrame !== false && (!details.requestingUrl || details.requestingUrl === entry) });
    if (!allowed && wc === mainWindow?.webContents) lastCaptureDenial = `Hidden отклонил запрос ${permission} (режим ${captureMode || 'не запущен'}).`;
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => allowMediaRequest({ trusted: wc === mainWindow?.webContents && wc?.getURL() === entry && mediaArmed, mode: captureMode, permission, mediaTypes: details.mediaType ? [details.mediaType] : ['audio'], mainFrame: details.isMainFrame !== false && (!details.requestingUrl || details.requestingUrl === entry) }));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame !== mainWindow?.webContents.mainFrame || !displaySource || captureMode !== 'system' || !mediaArmed) { lastCaptureDenial = 'Не выбран источник системного звука.'; callback({}); return; }
    try {
      const source = (await sources({ width: 0, height: 0 })).find(s => s.id === displaySource);
      displaySource = null;
      callback(source ? { video: source, audio: 'loopback' } : {});
    } catch { displaySource = null; callback({}); }
  }, { useSystemPicker: nativePicker });
  ipcMain.handle('key:status', (event, provider) => { trusted(event); return Boolean(keys[providerName(provider)]); });
  ipcMain.handle('key:set', (event, provider, key) => {
    trusted(event); providerName(provider);
    if (typeof key !== 'string' || key.length > 512) throw Error('Некорректный ключ.');
    if (provider === 'gemini' && key.trim().endsWith('.')) throw Error('В конце ключа точка. Скопируйте ключ без знака пунктуации.');
    if (provider === 'gemini' && keys.gemini !== key.trim() && mediaArmed) {
      mediaArmed = false; captureMode = null; nativeAudio?.stop(); stopSpeech(); controllers.get('audio')?.abort();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('session:stop');
    }
    keys[provider] = key.trim(); return Boolean(keys[provider]);
  });
  ipcMain.handle('key:test', (event, model, provider = 'gemini') => {
    trusted(event); providerName(provider);
    if (provider !== 'gemini') return runTask('probe', async signal => ({
      answer: await generate({ provider, model, question: 'Reply with OK only.', context: '', style: 'brief' }, keys[provider], fetchImpl, { signal })
    }));
    if (typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) return { error: 'Укажите модель.' };
    return runTask('probe', async signal => ({ answer: await call({ model, input: 'Reply with OK only.' }, keys.gemini, fetchImpl, { signal }) }));
  });
  ipcMain.handle('window:privacy', event => {
    trusted(event); const win = BrowserWindow.fromWebContents(event.sender);
    return { platform: process.platform, protectionRequested: ['darwin', 'win32'].includes(process.platform) && win.isContentProtected(), shortcutRegistered, ...windowState() };
  });
  ipcMain.handle('window:hide', event => { trusted(event); BrowserWindow.fromWebContents(event.sender).hide(); });
  ipcMain.handle('window:hide-stop', event => { trusted(event); hideAndStop(); });
  ipcMain.handle('window:compact', (event, enabled) => {
    trusted(event); const win = BrowserWindow.fromWebContents(event.sender);
    if (enabled && !normalBounds) { normalBounds = win.getBounds(); compactPinned = win.isAlwaysOnTop(); win.setAlwaysOnTop(true); win.setMinimumSize(420, 220); win.setSize(620, 360); }
    else if (!enabled && normalBounds) { setClickThrough(false); win.setMinimumSize(900, 680); win.setBounds(normalBounds); normalBounds = null; win.setAlwaysOnTop(compactPinned); }
    publishWindowState();
    return Boolean(normalBounds);
  });
  ipcMain.handle('window:fit', (event, naturalHeight) => {
    trusted(event); const win = BrowserWindow.fromWebContents(event.sender);
    if (!normalBounds || typeof naturalHeight !== 'number' || !Number.isFinite(naturalHeight)) return null;
    const current = win.getBounds();
    const result = fitOverlay(current, screen.getDisplayMatching(current).workArea, Math.min(100000, Math.max(0, naturalHeight)));
    if (Object.keys(result.bounds).some(key => Math.abs(result.bounds[key] - current[key]) > 1)) win.setBounds(result.bounds);
    return result;
  });
  ipcMain.handle('window:click-through', (event, enabled) => {
    trusted(event);
    if (enabled && (!shortcuts.mouse?.registered || !shortcuts.hide?.registered)) return { error: 'Горячая клавиша возврата занята. Режим пропуска кликов недоступен.' };
    return { enabled: setClickThrough(enabled) };
  });
  ipcMain.handle('window:pin', (event, enabled) => { trusted(event); const win = BrowserWindow.fromWebContents(event.sender); win.setAlwaysOnTop(Boolean(enabled)); publishWindowState(); return win.isAlwaysOnTop(); });
  ipcMain.handle('answer:generate', (event, request) => {
    trusted(event);
    return runTask('answer', async signal => {
      const provider = providerName(request?.provider);
      let firstTokenMs = null; const started = performance.now();
      const onDelta = provider !== 'openai' ? text => {
        firstTokenMs ??= Math.round(performance.now() - started);
        if (!event.sender.isDestroyed()) event.sender.send('answer:delta', { text });
      } : undefined;
      const answer = await generate(request, keys[provider], fetchImpl, { signal, onDelta });
      return { answer, firstTokenMs, provider, model: request.model };
    });
  });
  ipcMain.handle('answer:cancel', event => { trusted(event); controllers.get('answer')?.abort(); });
  ipcMain.handle('audio:analyze', (event, request) => { trusted(event); return runTask('audio', async signal => await analyzeAudio(request, keys.gemini, fetchImpl, { signal })); });
  ipcMain.handle('speech:transcribe', (event, request) => {
    trusted(event); if (!mediaArmed) return { error: 'Сначала начните аудиосессию.' };
    return runTask('transcription', signal => transcribeAudio(request, keys.gemini, fetchImpl, { signal }));
  });
  ipcMain.handle('speech:probe', event => {
    trusted(event);
    return runTask('speech-probe', async signal => {
      const probe = new LiveTranscriber(() => {}, smoke ? require('../test/smoke-live.cjs') : undefined);
      const cancel = () => probe.stop(); signal.addEventListener('abort', cancel, { once: true });
      try { return await probe.start(keys.gemini); }
      finally { signal.removeEventListener('abort', cancel); probe.stop(); }
    });
  });
  ipcMain.handle('speech:live-start', async (event, request) => {
    trusted(event);
    if (!mediaArmed || !request || !Array.isArray(request.vocabulary) || request.vocabulary.length > 100 || request.vocabulary.some(x => typeof x !== 'string' || x.length > 80) || !Number.isSafeInteger(request.sessionId)) return { error: 'Некорректная аудиосессия.' };
    liveTranscriber?.stop();
    const current = new LiveTranscriber(value => { if (mediaArmed && liveTranscriber === current && !event.sender.isDestroyed()) event.sender.send('speech:live-event', { ...value, sessionId: request.sessionId }); }, smoke ? require('../test/smoke-live.cjs') : undefined);
    liveTranscriber = current;
    try { return await current.start(keys.gemini, request.vocabulary); } catch (error) { return fail(error); }
  });
  ipcMain.on('speech:pcm', (event, data) => {
    trusted(event); if (!mediaArmed || typeof data !== 'string' || data.length > 12000 || data.length < 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return;
    liveTranscriber?.send(data);
  });
  ipcMain.on('speech:end-turn', event => { trusted(event); if (mediaArmed) liveTranscriber?.endTurn(); });
  ipcMain.handle('speech:cancel', event => { trusted(event); controllers.get('speech-answer')?.abort(); });
  ipcMain.handle('speech:answer', (event, request) => {
    trusted(event); if (!mediaArmed || !Number.isSafeInteger(request?.id)) return { error: 'Аудиосессия остановлена.' };
    const provider = providerName(request.provider);
    const previous = controllers.get('speech-answer'); previous?.abort(); controllers.delete('speech-answer');
    return runTask('speech-answer', async signal => {
      return generateVoiceAnswer(request, keys[provider], fetchImpl, { signal, onDelta: (text, firstTokenMs) => {
        if (!signal.aborted && mediaArmed && !event.sender.isDestroyed()) event.sender.send('speech:delta', { id: request.id, text, firstTokenMs });
      }, onNotice: message => {
        if (!signal.aborted && mediaArmed && !event.sender.isDestroyed()) event.sender.send('speech:notice', { id: request.id, message });
      } });
    });
  });
  ipcMain.handle('media:diagnostics', event => {
    trusted(event);
    return { nativeAudio: process.platform === 'darwin' && fs.existsSync(nativeAudioPath) && !smoke, nativePicker, platform: process.platform, screen: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown', microphone: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown', applicationDenial: lastCaptureDenial };
  });
  ipcMain.handle('audio:native-start', async event => {
    trusted(event);
    if (captureMode !== 'system' || !mediaArmed || process.platform !== 'darwin') return { error: 'Системный источник не включён.' };
    nativeAudio?.stop();
    nativeAudio = new SystemAudio(nativeAudioPath, value => { if (!event.sender.isDestroyed() && mediaArmed) event.sender.send('audio:pcm', value); }, error => { if (!event.sender.isDestroyed()) event.sender.send('audio:native-error', error); });
    try { return await nativeAudio.start(); } catch (error) { return fail(error); }
  });
  ipcMain.handle('media:arm', (event, mode) => {
    trusted(event);
    if (![false, 'microphone', 'system'].includes(mode)) throw Error('Неизвестный источник звука.');
    captureMode = mode || null; mediaArmed = Boolean(mode); lastCaptureDenial = '';
    if (mediaArmed) { mainWindow.show(); mainWindow.focus(); }
    else { nativeAudio?.stop(); stopSpeech(); displaySource = null; controllers.get('audio')?.abort(); }
  });
  ipcMain.handle('media:sources', async event => {
    trusted(event);
    try { const list = await sources(); sourceIds = new Set(list.map(s => s.id)); return { sources: list.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })) }; }
    catch { return { error: 'Не удалось получить окна. Разрешите запись экрана для Electron или приложения, из которого он запущен, в настройках macOS.' }; }
  });
  ipcMain.handle('media:select', (event, id) => {
    trusted(event); if (!sourceIds.has(id)) throw Error('Выберите доступное окно.'); displaySource = id;
  });
  ipcMain.handle('media:snapshot', async (event, id) => {
    trusted(event);
    try {
      if (!sourceIds.has(id)) throw Error('Сначала выберите окно.');
      const source = (await sources({ width: 1920, height: 1080 })).find(s => s.id === id);
      if (!source || source.thumbnail.isEmpty()) throw Error('Окно недоступно. Проверьте разрешение записи экрана.');
      return { image: { data: source.thumbnail.toPNG().toString('base64'), mimeType: 'image/png' }, name: source.name };
    } catch (error) { return fail(error); }
  });
  ipcMain.handle('context:import', async event => {
    trusted(event);
    const result = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'Текстовый контекст', extensions: ['txt', 'md'] }], properties: ['openFile'] });
    if (result.canceled) return {};
    if (fs.statSync(result.filePaths[0]).size > 120000) return { error: 'Файл слишком большой.' };
    return { text: fs.readFileSync(result.filePaths[0], 'utf8').slice(0, 30000) };
  });
  const register = registerShortcut;
  register('hide', 'CommandOrControl+Shift+H', toggleWindow);
  shortcutRegistered = shortcuts.hide.registered;
  register('stop', 'CommandOrControl+Shift+Escape', hideAndStop);
  register('previous', 'CommandOrControl+Shift+Left', () => mainWindow?.webContents.send('answer:navigate', 1));
  register('next', 'CommandOrControl+Shift+Right', () => mainWindow?.webContents.send('answer:navigate', -1));
  register('mouse', 'CommandOrControl+Shift+M', () => setClickThrough(!clickThrough));
  let saved;
  try { saved = JSON.parse(fs.readFileSync(shortcutFile(), 'utf8')); } catch {}
  for (const [name, action] of Object.entries(shortcutActions)) {
    register(name, validChord(saved?.[name]) ? saved[name] : customDefaults[name], action);
  }
  ipcMain.handle('shortcut:save', (event, request) => {
    trusted(event);
    try { return changeShortcuts(request); } catch (error) { return fail(error); }
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); else { setClickThrough(false); mainWindow.show(); mainWindow.focus(); } });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { nativeAudio?.stop(); stopSpeech(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
