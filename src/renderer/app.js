(function () {
'use strict';

const $ = (s) => document.querySelector(s);
const api = window.api || {};

const STEPS = ['使用约定', '保存位置', '下载偏好', '就绪'];
const NEXT_LABEL = ['同意并继续', '继续', '继续', '开始使用'];

let settings = {
  downloadDir: '',
  onboardingCompleted: false,
  openFolderAfterDownload: true,
  readClipboardOnStart: true,
  themeColor: 'default',
  themeMode: 'dark',
  fontFamily: 'default',
  mirrorPrefix: '',
};
let step = 0;
let current = null;
let dir = '';

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSize(b) {
  if (!b) return '—';
  const mb = b / 1024 / 1024;
  return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}
function fmtSpeed(bps) {
  const mb = bps / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`;
}

/* ---------------- 引导页 ---------------- */
function showOnboarding(fromStep = 0) {
  step = fromStep;
  $('#onboarding').classList.remove('hidden');
  renderStep();
}

function renderStep() {
  document.querySelectorAll('.ob-step').forEach((el) => {
    el.classList.toggle('hidden', Number(el.dataset.step) !== step);
  });
  document.querySelectorAll('#ob-bar i').forEach((el, i) => {
    el.classList.toggle('on', i <= step);
  });
  $('#ob-step-name').textContent = STEPS[step];
  $('#ob-step-count').textContent = `${step + 1} / ${STEPS.length}`;
  $('#ob-back').textContent = step === 0 ? '退出' : '上一步';
  $('#ob-next-label').textContent = NEXT_LABEL[step];
  $('#ob-dir').textContent = dir || '—';
}

async function finishOnboarding() {
  settings = await api.saveSettings({
    onboardingCompleted: true,
    openFolderAfterDownload: $('#ob-openfolder').checked,
    readClipboardOnStart: $('#ob-clipboard').checked,
  });
  $('#onboarding').classList.add('hidden');
  applySettings();
}

$('#ob-back').addEventListener('click', () => {
  if (step === 0) { window.close(); return; }
  step -= 1;
  renderStep();
});

$('#ob-next').addEventListener('click', async () => {
  if (step === STEPS.length - 1) { await finishOnboarding(); return; }
  step += 1;
  renderStep();
});

$('#ob-choose').addEventListener('click', async () => {
  const d = await api.chooseDir();
  if (d) { dir = d; $('#ob-dir').textContent = d; applySettings(); }
});

/* ---------------- 主界面 ---------------- */
function applySettings() {
  $('#dir').textContent = settings.downloadDir || '—';
  $('#set-dirpath').textContent = settings.downloadDir || '—';
  $('#set-openfolder').checked = settings.openFolderAfterDownload !== false;
  $('#set-clipboard').checked = settings.readClipboardOnStart !== false;
  $('#set-mirror').value = settings.mirrorPrefix || '';
  applyMode(settings.themeMode);
  applyTheme(settings.themeColor);
  applyFont(settings.fontFamily);
  renderSwatches();
  document.querySelectorAll('#seg-font button').forEach((b) => {
    b.classList.toggle('on', (b.dataset.font || 'default') === (settings.fontFamily || 'default'));
  });
}

/* ---------------- 外观 ---------------- */
const PRESETS = ['#7ddc8e', '#7fb8ff', '#c39bff', '#ffb366', '#ff9ec4', '#7fe3dd'];
const DEFAULT_PRIMARY = '#7ddc8e';
const MEDIA_LIGHT = window.matchMedia('(prefers-color-scheme: light)');

function resolveMode(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return MEDIA_LIGHT.matches ? 'light' : 'dark';
}

function applyMode(mode) {
  const pref = mode || 'dark';
  const resolved = resolveMode(pref);
  document.documentElement.dataset.theme = resolved;
  document.querySelectorAll('#seg-mode button').forEach((b) => {
    b.classList.toggle('on', (b.dataset.mode || 'dark') === pref);
  });
  // 让系统标题栏按钮与窗口底色一起跟随，避免首帧闪一下
  if (api.setWindowTheme) api.setWindowTheme(resolved);
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

function hexToHsl(hex) {
  let { r, g, b } = hexToRgb(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return { r: to(r), g: to(g), b: to(b) };
}

function applyTheme(color) {
  const hex = color && color !== 'default' ? color : DEFAULT_PRIMARY;
  const light = document.documentElement.dataset.theme === 'light';
  let { r, g, b } = hexToRgb(hex);
  if (light) {
    // 浅色底上直接铺亮色会糊，只降明度、保留色相，别压成脏棕色
    const { h, s, l } = hexToHsl(hex);
    ({ r, g, b } = hslToHex(h, Math.min(1, s * 0.92), Math.min(l, 0.4)));
  }
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const root = document.documentElement.style;
  root.setProperty('--primary', `rgb(${r}, ${g}, ${b})`);
  root.setProperty('--on-primary', lum > 0.55 ? '#05110a' : '#ffffff');
  root.setProperty('--primary-container', `rgba(${r}, ${g}, ${b}, ${light ? 0.18 : 0.16})`);
}

function applyFont(kind) {
  const root = document.documentElement.style;
  if (kind === 'mono') {
    root.setProperty('--font-family', '"Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace');
  } else {
    root.removeProperty('--font-family');
  }
}

function renderSwatches() {
  const box = $('#swatches');
  const current = settings.themeColor && settings.themeColor !== 'default'
    ? settings.themeColor.toLowerCase() : 'default';
  box.innerHTML = '';
  PRESETS.forEach((hex) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (hex === current ? ' on' : '');
    b.style.background = hex;
    b.title = hex;
    b.addEventListener('click', () => pickTheme(hex));
    box.appendChild(b);
  });
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'swatch custom';
  custom.value = current === 'default' ? DEFAULT_PRIMARY : current;
  custom.title = '自定义颜色';
  custom.addEventListener('input', () => pickTheme(custom.value));
  box.appendChild(custom);
}

async function pickTheme(color) {
  settings = await api.saveSettings({ themeColor: color });
  applySettings();
}

/* ---------------- 设置面板 ---------------- */
function openSettings() {
  $('#settings').classList.remove('hidden');
  $('#upd-card').classList.add('hidden');
  $('#upd-hint').textContent = '';
  $('#set-ver').textContent = $('#ver').textContent || '—';
}
function closeSettings() { $('#settings').classList.add('hidden'); }

$('#set-close').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });

$('#set-dir').addEventListener('click', async () => {
  const d = await api.chooseDir();
  if (d) { settings.downloadDir = d; dir = d; applySettings(); }
});

$('#set-openfolder').addEventListener('change', async (e) => {
  settings = await api.saveSettings({ openFolderAfterDownload: e.target.checked });
});

$('#set-clipboard').addEventListener('change', async (e) => {
  settings = await api.saveSettings({ readClipboardOnStart: e.target.checked });
});

$('#set-mirror').addEventListener('change', async (e) => {
  settings = await api.saveSettings({ mirrorPrefix: e.target.value.trim() });
  hint('');
});

document.querySelectorAll('#seg-font button').forEach((b) => {
  b.addEventListener('click', async () => {
    settings = await api.saveSettings({ fontFamily: b.dataset.font });
    applySettings();
  });
});

document.querySelectorAll('#seg-mode button').forEach((b) => {
  b.addEventListener('click', async () => {
    settings = await api.saveSettings({ themeMode: b.dataset.mode });
    applySettings();
  });
});

MEDIA_LIGHT.addEventListener('change', () => {
  if ((settings.themeMode || 'dark') === 'system') applySettings();
});

$('#btn-replay').addEventListener('click', () => {
  closeSettings();
  showOnboarding(0);
});

/* ---------------- 更新 ---------------- */
let pendingUpdate = null;

$('#btn-update').addEventListener('click', async () => {
  const btn = $('#btn-update');
  btn.disabled = true;
  $('#upd-hint').textContent = '正在查询 GitHub…';
  $('#upd-card').classList.add('hidden');
  try {
    const r = await api.checkUpdate();
    if (!r || !r.ok) {
      $('#upd-hint').textContent = (r && r.reason) || '查不到更新信息';
      return;
    }
    if (!r.hasUpdate) {
      $('#upd-hint').textContent = `已是最新版本（${r.current}）`;
      return;
    }
    pendingUpdate = r;
    $('#upd-hint').textContent = '';
    $('#upd-title').textContent = `发现新版本 ${r.latest}`;
    $('#upd-notes').textContent = r.notes || '（这次没有写更新说明）';
    $('#upd-card').classList.remove('hidden');
  } catch (e) {
    $('#upd-hint').textContent = String(e.message || e).replace(/^Error:\s*/, '');
  } finally {
    btn.disabled = false;
  }
});

$('#btn-upd-dl').addEventListener('click', async () => {
  if (!pendingUpdate || !pendingUpdate.asset) return;
  const btn = $('#btn-upd-dl');
  btn.disabled = true;
  btn.textContent = '下载中…';
  $('#upd-progress').classList.remove('hidden');
  $('#upd-bar').style.width = '0%';
  $('#upd-pct').textContent = '0%';
  $('#upd-speed').textContent = '';
  $('#upd-hint').textContent = '开始下载安装包…';
  try {
    const r = await api.downloadUpdate({ asset: pendingUpdate.asset });
    $('#upd-bar').style.width = '100%';
    $('#upd-pct').textContent = '100%';
    $('#upd-speed').textContent = fmtSize(r.size);
    $('#upd-hint').textContent = `已下载 ${fmtSize(r.size)}，正在打开安装程序…`;
    btn.textContent = '重新下载';
    await api.runInstaller(r.path);
  } catch (e) {
    $('#upd-hint').textContent = String(e.message || e).replace(/^Error:\s*/, '');
    btn.textContent = '继续下载';
  } finally {
    btn.disabled = false;
  }
});

// 更新下载进度（独立于视频下载的 app:progress，避免两个进度条串台）
function renderUpdateProgress(p) {
  if (!p) return;
  const pct = p.total ? Math.round(p.percent || 0) : 0;
  $('#upd-bar').style.width = `${pct}%`;
  $('#upd-pct').textContent = p.total
    ? `${pct}% · ${fmtSize(p.received)} / ${fmtSize(p.total)}`
    : fmtSize(p.received);
  $('#upd-speed').textContent = p.speed ? fmtSpeed(p.speed) : '';
}

if (api.onUpdateBegin) {
  api.onUpdateBegin((info) => {
    $('#upd-progress').classList.remove('hidden');
    $('#upd-bar').style.width = '0%';
    $('#upd-speed').textContent = '连接中…';
    if (info && info.index > 0) $('#upd-hint').textContent = '换一个下载源重试…（已下载的部分会接着续）';
  });
}
if (api.onUpdateProgress) api.onUpdateProgress(renderUpdateProgress);
if (api.onUpdateDone) {
  api.onUpdateDone(() => {
    $('#upd-bar').style.width = '100%';
    $('#upd-pct').textContent = '100%';
  });
}
if (api.onUpdateError) {
  api.onUpdateError(() => {
    $('#upd-speed').textContent = '连接中断';
  });
}

async function pasteFromClipboard(silent = false) {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) { if (!silent) hint('剪贴板是空的'); return; }
    $('#input').value = t;
    if (!silent) hint('已粘贴');
  } catch (e) {
    if (!silent) hint('读不到剪贴板，手动粘一下');
  }
}

function hint(text, bad = false) {
  const el = $('#hint');
  el.textContent = text || '';
  el.style.color = bad ? '#ff8a80' : '';
}

async function doParse() {
  const text = $('#input').value.trim();
  if (!text) { hint('先粘一条链接', true); return; }
  $('#btn-parse').disabled = true;
  hint('正在解析…');
  $('#result').classList.add('hidden');
  try {
    const info = await api.resolve(text);
    current = info;
    renderResult(info);
    hint('');
  } catch (e) {
    hint(String(e.message || e).replace(/^Error:\s*/, ''), true);
  } finally {
    $('#btn-parse').disabled = false;
  }
}

function renderResult(info) {
  $('#res-cover').src = info.cover || '';
  $('#res-title').textContent = info.desc || '未命名';
  $('#res-sub').textContent = info.author ? `@${info.author}` : '';
  $('#tag-dur').textContent = `时长 ${fmtDur(info.durationMs)}`;
  $('#tag-size').textContent = info.width ? `${info.width}×${info.height}` : '—';
  $('#result').classList.remove('hidden');
  $('#progress-wrap').classList.add('hidden');
  $('#btn-open').classList.add('hidden');
  $('#btn-download').disabled = false;
}

async function doDownload() {
  if (!current) return;
  $('#btn-download').disabled = true;
  $('#progress-wrap').classList.remove('hidden');
  hint('');
  try {
    const r = await api.download(current);
    hint(`已保存 ${fmtSize(r.size)}`);
    $('#btn-open').classList.remove('hidden');
    $('#btn-open').dataset.path = r.path;
    if (settings.openFolderAfterDownload) api.showItem(r.path);
  } catch (e) {
    hint(String(e.message || e).replace(/^Error:\s*/, ''), true);
    $('#btn-download').disabled = false;
  }
}

$('#btn-parse').addEventListener('click', doParse);
$('#btn-download').addEventListener('click', doDownload);
$('#btn-paste').addEventListener('click', () => pasteFromClipboard(false));
$('#btn-open').addEventListener('click', (e) => api.showItem(e.currentTarget.dataset.path));
$('#btn-dir').addEventListener('click', async () => {
  const d = await api.chooseDir();
  if (d) { settings.downloadDir = d; dir = d; applySettings(); }
});
$('#btn-settings').addEventListener('click', openSettings);
$('#input').addEventListener('input', () => hint(''));

/* ---------------- 事件 ---------------- */
if (api.onStatus) {
  api.onStatus((s) => {
    if (s && s.phase === 'captcha') {
      hint('需要过一次人机验证，已弹出窗口，点一下就好');
    } else if (s && s.phase === 'opening') {
      hint('正在打开页面…');
    }
  });
}

if (api.onProgress) {
  api.onProgress((p) => {
    const pct = Math.round(p.percent || 0);
    $('#progress-bar').style.width = `${pct}%`;
    $('#progress-text').textContent = p.total
      ? `${pct}% · ${fmtSize(p.received)} / ${fmtSize(p.total)}`
      : `${pct}% · ${fmtSize(p.received)}`;
    $('#progress-speed').textContent = p.speed ? fmtSpeed(p.speed) : '';
  });
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  if (api.getSettings) {
    settings = { ...settings, ...(await api.getSettings()) };
  }
  dir = settings.downloadDir || '';
  applySettings();

  if (api.version) {
    $('#ver').textContent = `v${await api.version()}`;
  }

  if (!settings.onboardingCompleted) {
    showOnboarding(0);
  } else if (settings.readClipboardOnStart !== false) {
    pasteFromClipboard(true);
  }
})();

})();
