'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = () => ({
  downloadDir: path.join(app.getPath('downloads'), '抖音下载器'),
  onboardingCompleted: false,
  openFolderAfterDownload: true,
  readClipboardOnStart: true,
  themeColor: 'default', // 'default' 或 #rrggbb
  fontFamily: 'default', // 'default' | 'mono'
  mirrorPrefix: '', // 空 = 使用内置 gh-proxy
});

let file = null;
let cache = null;

function settingsFile() {
  if (!file) file = path.join(app.getPath('userData'), 'settings.json');
  return file;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    cache = { ...DEFAULTS(), ...JSON.parse(raw) };
  } catch (_) {
    cache = DEFAULTS();
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}

module.exports = { load, save, DEFAULTS };
