'use strict';
// 注入到抖音页面：钩住页面自己的 XHR / fetch，
// 把含 play_addr 的 aweme/detail 响应原文回传主进程。
const { ipcRenderer } = require('electron');

(function () {
  const TARGET = '/aweme/detail';

  function isDetail(u) {
    return typeof u === 'string' && u.indexOf(TARGET) >= 0;
  }

  function report(text) {
    try {
      if (text && text.indexOf('play_addr') >= 0) {
        ipcRenderer.send('douyin:detail', String(text));
      }
    } catch (_) { /* ignore */ }
  }

  // ---- XMLHttpRequest ----
  try {
    const OrigOpen = XMLHttpRequest.prototype.open;
    const OrigSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__dshUrl = url; } catch (_) {}
      return OrigOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      const url = this.__dshUrl;
      if (isDetail(url)) {
        this.addEventListener('load', function () {
          try {
            if (this.status === 200 && this.responseText) report(this.responseText);
          } catch (_) {}
        });
      }
      return OrigSend.apply(this, arguments);
    };
  } catch (_) { /* ignore */ }

  // ---- fetch ----
  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url);
        const p = origFetch.apply(this, arguments);
        if (isDetail(url)) {
          p.then(function (res) {
            try {
              res.clone().text().then(report).catch(function () {});
            } catch (_) {}
          }).catch(function () {});
        }
        return p;
      };
    }
  } catch (_) { /* ignore */ }
})();
