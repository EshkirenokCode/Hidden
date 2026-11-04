const { app, BrowserWindow, ipcMain, session, globalShortcut, desktopCapturer, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { generate } = require('./provider.cjs');
const { analyzeAudio, call } = require('./gemini.cjs');
const keys = { openai: process.env.OPENAI_API_KEY || '', gemini: process.env.GEMINI_API_KEY || '' };
// Preserve the development profile when changing the product name.
app.setPath('userData', path.join(app.getPath('appData'), 'ghost-workspace'));
app.setName('Hidden');
app.setAppUserModelId('com.eshkirenok.hidden');
const entry = pathToFileURL(path.join(__dirname, '../src/index.html')).href;
const smoke = process.argv.includes('--smoke-test');
if (smoke) {
  app.setPath('userData', path.join(require('node:os').tmpdir(), `ghost-smoke-${process.pid}`));
  keys.openai = ''; keys.gemini = '';
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
}
let mainWindow, shortcutRegistered = false, mediaArmed = false, displaySource = null;
let sourceIds = new Set();
let normalBounds;
let compactPinned = false;
const shortcuts = {};
function windowState() { return { compact: Boolean(normalBounds), pinned: Boolean(mainWindow?.isAlwaysOnTop()), shortcuts }; }
function publishWindowState() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:state', windowState()); }
function hideAndStop() {
  mediaArmed = false; displaySource = null;
  for (const controller of controllers.values()) controller.abort();
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('session:stop'); mainWindow.hide(); }
}
const controllers = new Map();
function providerName(value) {
  if (!['openai', 'gemini'].includes(value)) throw Error('Неизвестный провайдер.');
  return value;
}
function trusted(event) {
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== entry) throw Error('Недопустимый источник запроса.');
}
function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
  finally { controllers.delete(type); }
}
async function sources(thumbnailSize = { width: 320, height: 180 }) {
  const list = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize });
  return list.filter(s => s.name !== 'Hidden' && s.name !== 'Ghost · Interview workspace' && !s.name.startsWith('Ghost ·'));
}
function createWindow() {
  const win = new BrowserWindow({ show: false, width: 1340, height: 900, minWidth: 900, minHeight: 680, backgroundColor: '#101113', title: 'Hidden', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  mainWindow = win;
  normalBounds = null;
  if (['darwin', 'win32'].includes(process.platform)) win.setContentProtection(true);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('closed', () => { mediaArmed = false; displaySource = null; for (const c of controllers.values()) c.abort(); });
  win.loadURL(entry);
  if (smoke) {
    win.webContents.once('did-finish-load', () => require('../test/smoke-runner.cjs')({ app, win, toggleWindow }));
    setTimeout(() => app.exit(1), 30000).unref();
  }
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const allowed = wc === mainWindow?.webContents && wc.getURL() === entry && mediaArmed && permission === 'media' && (details.mediaTypes || []).every(type => type === 'audio');
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => wc === mainWindow?.webContents && wc.getURL() === entry && mediaArmed && ['media', 'display-capture'].includes(permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame !== mainWindow?.webContents.mainFrame || !displaySource || !mediaArmed) { callback({}); return; }
    try {
      const source = (await sources({ width: 0, height: 0 })).find(s => s.id === displaySource);
      displaySource = null;
      callback(source ? { video: source, audio: 'loopback' } : {});
    } catch { displaySource = null; callback({}); }
  });
  ipcMain.handle('key:status', (event, provider) => { trusted(event); return Boolean(keys[providerName(provider)]); });
  ipcMain.handle('key:set', (event, provider, key) => {
    trusted(event); providerName(provider);
    if (typeof key !== 'string' || key.length > 512) throw Error('Некорректный ключ.');
    if (provider === 'gemini' && key.trim().endsWith('.')) throw Error('В конце ключа точка. Скопируйте ключ без знака пунктуации.');
    keys[provider] = key.trim(); return Boolean(keys[provider]);
  });
  ipcMain.handle('key:test', (event, model) => {
    trusted(event);
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
    if (enabled && !normalBounds) { normalBounds = win.getBounds(); compactPinned = win.isAlwaysOnTop(); win.setAlwaysOnTop(true); win.setMinimumSize(480, 500); win.setSize(650, 720); }
    else if (!enabled && normalBounds) { win.setMinimumSize(900, 680); win.setBounds(normalBounds); normalBounds = null; win.setAlwaysOnTop(compactPinned); }
    publishWindowState();
    return Boolean(normalBounds);
  });
  ipcMain.handle('window:pin', (event, enabled) => { trusted(event); const win = BrowserWindow.fromWebContents(event.sender); win.setAlwaysOnTop(Boolean(enabled)); publishWindowState(); return win.isAlwaysOnTop(); });
  ipcMain.handle('answer:generate', (event, request) => {
    trusted(event);
    return runTask('answer', async signal => {
      const provider = providerName(request?.provider);
      let firstTokenMs = null; const started = performance.now();
      const onDelta = provider === 'gemini' ? text => {
        firstTokenMs ??= Math.round(performance.now() - started);
        if (!event.sender.isDestroyed()) event.sender.send('answer:delta', { text });
      } : undefined;
      const answer = await generate(request, keys[provider], fetchImpl, { signal, onDelta });
      return { answer, firstTokenMs, provider, model: request.model };
    });
  });
  ipcMain.handle('answer:cancel', event => { trusted(event); controllers.get('answer')?.abort(); });
  ipcMain.handle('audio:analyze', (event, request) => { trusted(event); return runTask('audio', async signal => await analyzeAudio(request, keys.gemini, fetchImpl, { signal })); });
  ipcMain.handle('media:arm', (event, enabled) => {
    trusted(event); mediaArmed = Boolean(enabled);
    if (!mediaArmed) { displaySource = null; controllers.get('audio')?.abort(); }
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
  const register = (name, chord, action) => { shortcuts[name] = { chord, registered: globalShortcut.register(chord, action) }; };
  register('hide', 'CommandOrControl+Shift+H', toggleWindow);
  shortcutRegistered = shortcuts.hide.registered;
  register('stop', 'CommandOrControl+Shift+Escape', hideAndStop);
  register('answer', 'CommandOrControl+Shift+Space', () => mainWindow?.webContents.send('session:answer-last'));
  register('snapshot', 'CommandOrControl+Shift+S', () => mainWindow?.webContents.send('session:snapshot'));
  register('previous', 'CommandOrControl+Shift+Left', () => mainWindow?.webContents.send('answer:navigate', 1));
  register('next', 'CommandOrControl+Shift+Right', () => mainWindow?.webContents.send('answer:navigate', -1));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
