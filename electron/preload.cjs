const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('ghost', {
  keyStatus: provider => ipcRenderer.invoke('key:status', provider),
  setKey: (provider, key) => ipcRenderer.invoke('key:set', provider, key),
  testKey: model => ipcRenderer.invoke('key:test', model),
  privacyStatus: () => ipcRenderer.invoke('window:privacy'),
  hide: () => ipcRenderer.invoke('window:hide'),
  hideStop: () => ipcRenderer.invoke('window:hide-stop'),
  onStop: callback => listen('session:stop', callback),
  onWindowState: callback => listen('window:state', callback),
  onNavigate: callback => listen('answer:navigate', callback),
  compact: enabled => ipcRenderer.invoke('window:compact', enabled),
  generate: request => ipcRenderer.invoke('answer:generate', request),
  cancel: () => ipcRenderer.invoke('answer:cancel'),
  onDelta: callback => listen('answer:delta', callback),
  analyzeAudio: request => ipcRenderer.invoke('audio:analyze', request),
  armMedia: enabled => ipcRenderer.invoke('media:arm', enabled),
  sources: () => ipcRenderer.invoke('media:sources'),
  selectSource: id => ipcRenderer.invoke('media:select', id),
  snapshot: id => ipcRenderer.invoke('media:snapshot', id),
  importContext: () => ipcRenderer.invoke('context:import'),
  onAnswerLast: callback => listen('session:answer-last', callback),
  onSnapshot: callback => listen('session:snapshot', callback),
  pin: enabled => ipcRenderer.invoke('window:pin', enabled)
});
