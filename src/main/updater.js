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
    mirrorUrl: msi ? mirrorUrl(msi.browser_download_url, opts.mirrorPrefix) : '',
  };
}

function downloadTo(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'douyin-downloader' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(downloadTo(res.headers.location, dest, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败，HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      let last = Date.now();
      let lastBytes = 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (onProgress && now - last > 150) {
          const speed = ((received - lastBytes) / (now - last)) * 1000;
          onProgress({ received, total, percent: total ? (received / total) * 100 : 0, speed });
          last = now;
          lastBytes = received;
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => resolve({ path: dest, size: received }));
      });
      out.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

module.exports = { checkUpdate, downloadTo, mirrorUrl, DEFAULT_MIRROR, OWNER, REPO };
