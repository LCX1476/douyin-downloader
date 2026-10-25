'use strict';
const https = require('https');
const path = require('path');
const { BrowserWindow, session, ipcMain } = require('electron');

let log = () => {};
function setLogger(fn) { log = typeof fn === 'function' ? fn : () => {}; }

const PARTITION = 'persist:douyin';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 从任意分享文本里抠出短链或 aweme_id */
function extractLink(text) {
  const t = String(text || '');
  const m = t.match(/https?:\/\/[^\s"'<>]+/g);
  if (!m) return null;
  for (const raw of m) {
    const u = raw.replace(/[)，。、！？；：]+$/, '');
    if (/v\.douyin\.com\/[A-Za-z0-9]+/.test(u)) return u;
    if (/douyin\.com\//.test(u)) return u;
  }
  return null;
}

function idFromUrl(u) {
  const a = u.match(/\/video\/(\d{10,})/);
  if (a) return a[1];
  const b = u.match(/modal_id=(\d{10,})/);
  if (b) return b[1];
  const c = u.match(/share\/video\/(\d{10,})/);
  if (c) return c[1];
  return null;
}

/** 跟随 302 解析短链 */
function followRedirect(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('短链跳转次数过多'));
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA }, timeout: 15000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(followRedirect(new URL(res.headers.location, url).toString(), depth + 1));
        }
        res.resume();
        resolve(url);
      }
    );
    req.on('timeout', () => { req.destroy(new Error('解析短链超时')); });
    req.on('error', reject);
  });
}

async function toAwemeId(input) {
  const link = extractLink(input);
  if (!link) throw new Error('没找到链接，把整段分享文字粘进来就行');
  const direct = idFromUrl(link);
  if (direct) return direct;
  const finalUrl = await followRedirect(link);
  const id = idFromUrl(finalUrl);
  if (!id) throw new Error('这条链接里没有视频 ID（可能不是视频作品）');
  return id;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 用隐藏窗口加载视频页，由注入的 preload 钩住页面自己的 XHR/fetch，
 * 把含 play_addr 的 aweme/detail 响应原文回传给主进程。
 * 命中人机验证时把窗口显示出来，让用户点一次。
 */
async function resolveInfo(input, onStatus = () => {}) {
  log('resolveInfo: start');
  const awemeId = await toAwemeId(input);
  log('resolveInfo: awemeId=' + awemeId);
  onStatus({ phase: 'opening', awemeId });

  const win = new BrowserWindow({
    width: 1120, height: 800, show: false,
    title: '抖音下载器 · 解析中',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'inject.js'),
    },
  });
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(UA);

  let raw = null;
  let resolveHit = null;
  const hitPromise = new Promise((r) => { resolveHit = r; });
  const onDetail = (_e, text) => {
    log('preload detail payload: ' + (text ? text.length : 0) + ' bytes');
    if (text && text.includes('play_addr') && !raw) {
      raw = text;
      if (resolveHit) resolveHit(text);
    }
  };
  ipcMain.on('douyin:detail', onDetail);

  const url = `https://www.douyin.com/video/${awemeId}`;
  log('loadURL ' + url);
  win.loadURL(url).catch((e) => log('loadURL failed: ' + (e && e.message)));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load ' + code + ' ' + desc));
  win.webContents.on('did-finish-load', () => log('window did-finish-load: ' + win.webContents.getURL()));

  let shownForCaptcha = false;
  const deadline = Date.now() + 45000;
  let probeAt = Date.now() + 6000;
  let probes = 0;

  while (!raw && Date.now() < deadline) {
    // 页面自己不请求 detail 时，主动用页面上下文同源请求一次
    if (!raw && probes < 3 && Date.now() >= probeAt) {
      probes += 1;
      probeAt = Date.now() + 9000;
      try {
        const js =
          '(async () => { try { const r = await fetch("/aweme/v1/web/aweme/detail/?aweme_id=' +
          awemeId +
          '&aid=6383&device_platform=webapp&version_code=170400&version_name=17.4.0", { credentials: "include" });' +
          ' const t = await r.text(); return r.status + "|" + t.length + "|" + t; } catch (e) { return "ERR|" + e.message; } })()';
        const out = await win.webContents.executeJavaScript(js, true);
        const s = String(out || '');
        const bar = s.indexOf('|');
        const bar2 = s.indexOf('|', bar + 1);
        log('probe#' + probes + ' ' + s.slice(0, 60) + ' ... len=' + s.length);
        const body = bar2 >= 0 ? s.slice(bar2 + 1) : '';
        if (body.includes('play_addr') && !raw) {
          raw = body;
          if (resolveHit) resolveHit(body);
        }
      } catch (e) {
        log('probe#' + probes + ' failed: ' + (e && e.message));
      }
    }

    if (!shownForCaptcha) {
      let cur = '';
      try { cur = win.webContents.getURL(); } catch (_) {}
      if (/verifycenter|captcha|verify\.snssdk/.test(cur)) {
        shownForCaptcha = true;
        log('captcha page detected, showing window');
        onStatus({ phase: 'captcha' });
        try { win.show(); win.focus(); } catch (_) {}
      }
    }
    await sleep(400);
  }

  try { ipcMain.removeListener('douyin:detail', onDetail); } catch (_) {}
  if (!win.isDestroyed()) win.destroy();

  if (!raw) throw new Error('没拿到视频信息：可能是链接失效，或验证没通过（重试一次通常就好）');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error('拿到的数据不是合法 JSON');
  }
  const a = parsed.aweme_detail || (parsed.data && parsed.data.aweme_detail);
  if (!a) throw new Error('返回里没有作品详情');
  return normalize(a, awemeId);
}

function normalize(a, awemeId) {
  const v = a.video || {};
  const list = (v.play_addr && v.play_addr.url_list) || [];
  const urls = list.map((u) => u.replace('/playwm/', '/play/'));
  if (!urls.length) throw new Error('这条作品没有可下载的视频流');
  return {
    awemeId,
    desc: a.desc || '未命名',
    author: (a.author && a.author.nickname) || '',
    durationMs: v.duration || 0,
    width: v.width || 0,
    height: v.height || 0,
    cover: (v.cover && v.cover.url_list && v.cover.url_list[0]) || '',
    urls,
    url: urls[0],
  };
}

module.exports = { resolveInfo, extractLink, toAwemeId, UA, PARTITION, setLogger };
