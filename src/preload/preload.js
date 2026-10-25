'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (p) => ipcRenderer.invoke('settings:save', p),
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  resolve: (text) => ipcRenderer.invoke('douyin:resolve', text),
  download: (info) => ipcRenderer.invoke('douyin:download', info),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openDir: (p) => ipcRenderer.invoke('shell:openDir', p),
  version: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (payload) => ipcRenderer.invoke('updates:download', payload),
  runInstaller: (p) => ipcRenderer.invoke('shell:openDir', p),
  onStatus: (cb) => ipcRenderer.on('app:status', (_e, s) => cb(s)),
  onProgress: (cb) => ipcRenderer.on('app:progress', (_e, p) => cb(p)),
});
