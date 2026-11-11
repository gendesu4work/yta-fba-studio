const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const { Engine } = require('./lib/engine');
const updater = require('./lib/updater');

let win, engine;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

let mode = 'window';
function createWindow(m = 'window') {
  Menu.setApplicationMenu(null);
  const old = win; mode = m;
  const { screen } = require('electron');
  const opts = {
    width: 1280, height: 860, minWidth: 1000, minHeight: 700, backgroundColor: '#f7f8fa', title: 'YTA and FBA Studio',
    icon: path.join(__dirname, 'build', 'icon.ico'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  };
  if (m === 'borderless') { Object.assign(opts, { frame: false, ...screen.getPrimaryDisplay().bounds, resizable: false }); }
  win = new BrowserWindow(opts);
  win.once('ready-to-show', () => { if (m === 'fullscreen') win.setFullScreen(true); win.show(); });
  win.webContents.on('before-input-event', (_e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11') applyMode(mode === 'fullscreen' ? 'window' : 'fullscreen');
    else if (i.key === 'Escape' && win.isFullScreen()) applyMode('window');
  });
  win.webContents.on('did-finish-load', () => send('winmode', mode));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (old && !old.isDestroyed()) old.destroy();
}
function applyMode(m) {
  if (engine) engine.setSettings({ windowMode: m });
  if (m === mode && win) return;
  if (m === 'borderless' || mode === 'borderless') return createWindow(m);
  mode = m; win.setFullScreen(m === 'fullscreen'); send('winmode', m);
}

const wrap = (fn) => async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: e.message }; } };

app.whenReady().then(() => {
  const ws = process.env.SS_WORKSPACE || path.join(app.getPath('documents'), 'Shorts Studio'); // SS_WORKSPACE is for testing only
  engine = new Engine(ws, send);
  engine.noteVersion(app.getVersion());
  // long jobs are fire-and-forget: progress arrives through events
  const bg = (fn) => (...a) => { Promise.resolve().then(() => fn(...a)).catch((e) => { engine.feed('Error: ' + e.message); engine.finish(); }); return true; };
  ipcMain.handle('state', wrap(() => engine.publicState()));
  ipcMain.handle('settings', wrap((p) => engine.setSettings(p)));
  ipcMain.handle('check', wrap(bg(() => engine.checkSetup())));
  ipcMain.handle('ideas', wrap(bg(() => engine.generateIdeas())));
  ipcMain.handle('select', wrap((ids) => engine.select(ids)));
  ipcMain.handle('scripts', wrap(bg(() => engine.generateScripts())));
  ipcMain.handle('updatePost', wrap((slug, post) => engine.updatePost(slug, post)));
  ipcMain.handle('approveScript', wrap((slug, v) => engine.approveScript(slug, v)));
  ipcMain.handle('discard', wrap((slug) => engine.discard(slug)));
  ipcMain.handle('produce', wrap(bg(() => engine.produce())));
  ipcMain.handle('accept', wrap((slug) => engine.accept(slug)));
  ipcMain.handle('reject', wrap((slug) => engine.reject(slug)));
  ipcMain.handle('retryJob', wrap((id) => engine.retryJob(id)));
  ipcMain.handle('cancel', wrap(() => engine.cancel()));
  ipcMain.handle('refFiles', wrap(async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick reference videos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }] });
    if (r.canceled) return 0;
    r.filePaths.forEach((f) => bg(() => engine.addRef(f, 'file'))());
    return r.filePaths.length;
  }));
  ipcMain.handle('refUrl', wrap((u) => { if (!/^https:\/\//.test(u)) throw new Error('Paste a full https:// link.'); bg(() => engine.addRef(u, 'url'))(); return true; }));
  ipcMain.handle('addMemory', wrap((t) => engine.addMemory(t)));
  ipcMain.handle('toggleMemory', wrap((id, on) => engine.toggleMemory(id, on)));
  ipcMain.handle('removeMemory', wrap((id) => engine.removeMemory(id)));
  ipcMain.handle('toggleLesson', wrap((r, l, on) => engine.toggleLesson(r, l, on)));
  ipcMain.handle('removeRef', wrap((id) => engine.removeRef(id)));
  ipcMain.handle('musicFiles', wrap(async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add background music', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a'] }] });
    if (r.canceled) return 0;
    engine.addMusic(r.filePaths); return r.filePaths.length;
  }));
  ipcMain.handle('removeMusic', wrap((f) => engine.removeMusic(f)));
  ipcMain.handle('researchTrack', wrap(bg((f) => engine.researchTrack(f))));
  ipcMain.handle('review', wrap(bg((s) => engine.reviewNow(s))));
  ipcMain.handle('fix', wrap(bg((s, n) => engine.fixVideo(s, n))));
  ipcMain.handle('customSlot', wrap((s, t) => engine.setCustomSlot(s, t)));
  ipcMain.handle('approveFix', wrap((s) => engine.approveFix(s)));
  ipcMain.handle('discardFix', wrap((s) => engine.discardFix(s)));
  ipcMain.handle('retryUpload', wrap((s, p) => engine.retryUpload(s, p)));
  ipcMain.handle('retryProduce', wrap((s) => engine.retryProduce(s)));
  ipcMain.handle('alertRetry', wrap((id) => engine.retryAlert(id)));
  ipcMain.handle('alertDismiss', wrap((id) => engine.dismissAlert(id)));
  ipcMain.handle('dataInfo', wrap(() => engine.dataInfo()));
  ipcMain.handle('backupNow', wrap(() => engine.backup('manual')));
  ipcMain.handle('winMode', wrap((m) => applyMode(m)));
  ipcMain.handle('winCtl', wrap((a) => { if (a === 'min') win.minimize(); else if (a === 'close') app.quit(); }));
  ipcMain.handle('authStatus', wrap(() => engine.authStatus()));
  ipcMain.handle('authLogout', wrap(() => engine.authLogout()));
  ipcMain.handle('authLogin', wrap(() => engine.authLogin()));
  ipcMain.handle('openFolder', wrap((sub) => shell.openPath(path.join(engine.ws, sub || ''))));
  ipcMain.handle('openUrl', wrap((u) => { if (/^https:\/\//.test(u)) return shell.openExternal(u); }));
  createWindow(engine.state.settings.windowMode || 'window');
  const up = updater.init({ app, engine });
  ipcMain.handle('appInfo', wrap(() => ({ version: app.getVersion(), packaged: app.isPackaged })));
  ipcMain.handle('updateCheck', wrap(() => up.check(true)));
  ipcMain.handle('updateInstall', wrap(() => up.install()));
});
app.on('window-all-closed', () => app.quit());
