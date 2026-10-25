'use strict';
// 更新检查：直连 GitHub API（本机 api.github.com 可达）；资产下载走镜像前缀，避免 github.com 被墙。
const https = require('https');
const fs = require('fs');
const path = require('path');

const OWNER = 'LCX1476';
const REPO = 'douyin-downloader';

// 默认镜像：gh-proxy.com 前缀式（https://gh-proxy.com/https://github.com/...）
const DEFAULT_MIRROR = 'https://gh-proxy.com/';

function get(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'user-agent': 'douyin-downloader', accept: 'application/vnd.github+json' },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(get(res.headers.location, timeout));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', reject);
  });
}

function parseVer(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((x) => parseInt(x, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

function isNewer(latest, current) {
  const a = parseVer(latest);
  const b = parseVer(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function mirrorUrl(url, mirrorPrefix) {
  const prefix = (mirrorPrefix || DEFAULT_MIRROR).trim();
  if (!prefix) return url;
  if (!prefix.endsWith('/')) return `${prefix}/${url}`;
  return `${prefix}${url}`;
}

async function checkUpdate(currentVersion, opts = {}) {
  const owner = opts.owner || OWNER;
  const repo = opts.repo || REPO;
  const api = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const r = await get(api);
  if (r.status === 404) {
    const repoRes = await get(`https://api.github.com/repos/${owner}/${repo}`);
    if (repoRes.status === 404) {
      return {
        ok: false,
        reason: `仓库 ${owner}/${repo} 还不存在，先把项目发布到 GitHub`,
        current: currentVersion,
      };
    }
    return { ok: false, reason: '仓库还没有发布任何 Release', current: currentVersion };
  }
  if (r.status !== 200) {
    return { ok: false, reason: `GitHub API 返回 ${r.status}`, current: currentVersion };
  }
  let rel;
  try {
    rel = JSON.parse(r.body);
  } catch (_) {
    return { ok: false, reason: 'GitHub 返回内容无法解析', current: currentVersion };
  }
  const tag = rel.tag_name || rel.name || '';
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  // 优先 MSI，其次 NSIS 安装包（.exe），最后任意可执行资产
  const pick =
    assets.find((a) => /\.msi$/i.test(a.name)) ||
    assets.find((a) => /\.exe$/i.test(a.name) && /setup|install/i.test(a.name)) ||
    assets.find((a) => /\.exe$/i.test(a.name)) ||
    assets[0] ||
    null;
  const hasUpdate = isNewer(tag, currentVersion);
  return {
    ok: true,
    hasUpdate,
    current: currentVersion,
    latest: tag.replace(/^v/i, ''),
    tag,
    name: rel.name || tag,
    notes: (rel.body || '').slice(0, 4000),
    publishedAt: rel.published_at || '',
    htmlUrl: rel.html_url || '',
    asset: pick ? { name: pick.name, size: pick.size, url: pick.browser_download_url } : null,
    mirrorUrl: pick ? mirrorUrl(pick.browser_download_url, opts.mirrorPrefix) : '',
  };
}

function downloadTo(url, dest, onProgress, redirects = 0, opts = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('重定向次数过多'));
      return;
    }
    const part = `${dest}.part`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let have = 0;
    try {
      if (fs.existsSync(part)) have = fs.statSync(part).size;
    } catch (_) {
      have = 0;
    }

    const headers = { 'user-agent': 'douyin-downloader' };
    // 有残留就续传；服务器不认 Range 时会回 200，下面按 200 处理
    if (have > 0) headers.Range = `bytes=${have}-`;

    const req = https.get(url, { headers, timeout: opts.timeoutMs || 60000 }, (res) => {
      if (opts.signal) opts.signal.addEventListener('abort', () => res.destroy(), { once: true });
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(downloadTo(res.headers.location, dest, onProgress, redirects + 1, opts));
        return;
      }
      if (res.statusCode === 416 && have > 0) {
        res.resume();
        fs.renameSync(part, dest);
        resolve({ path: dest, size: have, resumed: true });
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        reject(new Error(`下载失败，HTTP ${res.statusCode}`));
        return;
      }

      // 206 时 content-length 是"剩余字节"，200 时是全长
      const ranged = res.statusCode === 206;
      if (!ranged && have > 0) have = 0;
      const bodyLen = Number(res.headers['content-length'] || 0);
      const total = bodyLen ? bodyLen + have : 0;

      let received = have;
      let last = Date.now();
      let lastBytes = received;
      const startedAt = last;

      const out = fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
      const emit = (force) => {
        const now = Date.now();
        if (onProgress && (force || now - last > 200)) {
          const speed = now > startedAt ? ((received - lastBytes) / (now - last || 1)) * 1000 : 0;
          onProgress({
            received,
            total,
            percent: total ? Math.min(100, (received / total) * 100) : 0,
            speed,
          });
          last = now;
          lastBytes = received;
        }
      };

      res.on('data', (chunk) => {
        received += chunk.length;
        emit(false);
      });
      res.pipe(out);
      out.on('error', reject);
      out.on('finish', () => {
        out.close(() => {
          emit(true);
          try {
            fs.renameSync(part, dest);
          } catch (e) {
            reject(e);
            return;
          }
          resolve({ path: dest, size: received, resumed: have > 0 });
        });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时，可重试继续下载')));
    req.on('error', reject);
  });
}

module.exports = { checkUpdate, downloadTo, mirrorUrl, DEFAULT_MIRROR, OWNER, REPO };
