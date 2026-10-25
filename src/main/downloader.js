'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { UA } = require('./resolver');

const REFERER = 'https://www.douyin.com/';

function safeName(s, max = 80) {
  const cleaned = String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/#/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = cleaned.slice(0, max).trim() || 'douyin-video';
  return cut;
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}${ext}`);
  let i = 2;
  while (fs.existsSync(p)) {
    p = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return p;
}

/** 发一个带 Referer 的 GET，返回 {status, headers, stream} */
function request(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Referer: REFERER, ...headers }, timeout: 30000 }, (res) => {
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

/**
 * 下载视频：先写 .part，完成后改名；支持 Range 续传。
 * onProgress({received, total, speed, percent})
 */
async function download(info, opts, onProgress = () => {}) {
  const dir = opts.dir;
  fs.mkdirSync(dir, { recursive: true });
  const base = safeName(info.desc);
  const finalPath = uniquePath(dir, base, '.mp4');
  const partPath = `${finalPath}.part`;

  let start = 0;
  if (fs.existsSync(partPath)) {
    start = fs.statSync(partPath).size;
  }

  const headers = start > 0 ? { Range: `bytes=${start}-` } : {};
  let res = await request(info.url, headers);
  if (res.statusCode === 403) {
    // 直链过期时最常见：让调用方刷新链接后重试
    throw new Error('下载被拒绝（403），直链可能已过期，请重新解析');
  }
  if (start > 0 && res.statusCode === 200) {
    // 服务器不支持续传，从头开始
    start = 0;
    fs.writeFileSync(partPath, Buffer.alloc(0));
  } else if (res.statusCode !== 200 && res.statusCode !== 206) {
    throw new Error(`下载失败：HTTP ${res.statusCode}`);
  }

  const total = start + Number(res.headers['content-length'] || 0);
  const out = fs.createWriteStream(partPath, { flags: start > 0 ? 'a' : 'w' });

  let received = start;
  const t0 = Date.now();
  let lastTick = 0;

  return new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastTick > 120) {
        lastTick = now;
        const speed = received / ((now - t0) / 1000);
        onProgress({
          received,
          total,
          speed,
          percent: total ? Math.min(100, (received / total) * 100) : 0,
        });
      }
    });
    res.on('error', (e) => { out.close(); reject(e); });
    out.on('error', (e) => reject(e));
    out.on('finish', () => {
      try {
        fs.renameSync(partPath, finalPath);
        onProgress({ received, total, speed: received / ((Date.now() - t0) / 1000), percent: 100 });
        resolve({ path: finalPath, size: received });
      } catch (e) { reject(e); }
    });
    res.pipe(out);
  });
}

module.exports = { download, safeName, REFERER };
