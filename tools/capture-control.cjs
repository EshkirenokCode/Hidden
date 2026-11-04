// Known unprotected fixture for checking that a browser capture is live.
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ title: 'Capture control — test only', width: 320, height: 160, x: 50, y: 130, alwaysOnTop: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Capture control — test only</title><body style="margin:0;background:#ff40b9;color:#100718;font:24px system-ui;padding:22px"><b>CONTROL VISIBLE</b><p style="font-size:13px">Local capture test · no private data</p>'));
});
app.on('window-all-closed', () => app.quit());
