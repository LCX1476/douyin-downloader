'use strict';
const path = require('path');
const fs = require('fs');

// 启动期日志（Windows GUI 子系统没有 stdout，出错时只能靠文件）
// 打包后 __dirname 在 app.asar 内不可写，所以落到 userData
const LOG_FILE = (() => {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), '_main.log');
  } catch {
    return path.join(require('os').tmpdir(), 'douyin-dl_main.log');
  }
})();
function logLine(...args) {
  try {
    const msg = args.map((a) => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => logLine('UNCAUGHT', e));
process.on('unhandledRejection', (e) => logLine('REJECTION', e));
logLine('--- boot', process.versions.electron, process.versions.node);

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const store = require('./store');
const { resolveInfo, setLogger } = require('./resolver');
const { download } = require('./downloader');
const updater = require('./updater');

setLogger(logLine);

let win = null;
const state = { busy: false, lastResult: null };

function createWindow() {
  logLine('createWindow');
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: '#000000',
    show: true,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#e8e6ef', height: 40 },
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    logLine('RENDER', level, message, `${sourceId}:${line}`);
  });
  win.webContents.on('preload-error', (_e, p, err) => logLine('PRELOAD-ERROR', p, err && err.stack));
  win.webContents.on('did-finish-load', () => logLine('did-finish-load'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => logLine('did-fail-load', code, desc, url));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    createWindow();

    ipcMain.handle('settings:get', () => store.load());
    ipcMain.handle('settings:save', (_e, patch) => store.save(patch || {}));

    ipcMain.handle('dialog:chooseDir', async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      return store.save({ downloadDir: r.filePaths[0] }).downloadDir;
    });

    ipcMain.handle('shell:showItem', (_e, p) => { if (p) shell.showItemInFolder(p); });
    ipcMain.handle('shell:openDir', async (_e, p) => { if (p) await shell.openPath(p); });

    ipcMain.handle('douyin:resolve', async (_e, text) => {
      if (state.busy) throw new Error('正在处理上一条，稍等');
      state.busy = true;
      try {
        const info = await resolveInfo(text, (s) => send('app:status', s));
        return info;
      } finally { state.busy = false; }
    });

    ipcMain.handle('douyin:download', async (_e, info) => {
      if (state.busy) throw new Error('正在下载，稍等');
      state.busy = true;
      try {
        const s = store.load();
        const r = await download(info, { dir: s.downloadDir }, (p) => send('app:progress', p));
        state.lastResult = r;
        return r;
      } finally { state.busy = false; }
    });

    ipcMain.handle('app:version', () => app.getVersion());

    ipcMain.handle('updates:check', async () => {
      const s = store.load();
      const r = await updater.checkUpdate(app.getVersion(), { mirrorPrefix: s.mirrorPrefix });
      return r;
    });

    ipcMain.handle('updates:download', async (_e, payload) => {
      if (!payload || !payload.asset || !payload.asset.url) throw new Error('没有可下载的安装包');
      const dir = path.join(app.getPath('temp'), 'douyin-dl-update');
      const dest = path.join(dir, payload.asset.name || 'setup.msi');
      const s = store.load();
      const primary = updater.mirrorUrl(payload.asset.url, s.mirrorPrefix);
      const fallbacks = [primary, payload.asset.url];
      let lastErr = null;
      for (const url of fallbacks) {
        try {
          const r = await updater.downloadTo(url, dest, (p) => send('app:progress', p));
          return { ...r, url };
        } catch (e) {
          lastErr = e;
          logLine('update download failed', url, e && e.message);
        }
      }
      throw lastErr || new Error('下载失败');
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!win) createWindow(); });
}
