/* =========================================================================
   Слой платформы: один и тот же код работает в браузере и в десктоп-обёртке
   (Electron / Tauri). Отвечает за:
     • определение среды (браузер / electron / tauri);
     • открытие внешних ссылок и скачивание файлов (в десктопе — нативно);
     • загрузку внешних движков (сейчас задел под Rodent IV) из памяти,
       а не из localStorage, чтобы не занимать место архива партий;
     • обмен большими объектами с обёрткой (blob: URL).
   Обёртка НЕ обязана существовать: при её отсутствии всё деградирует
   в обычный браузерный режим.
   ========================================================================= */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? null : root);
  if (isNode) module.exports = api;
  if (root) root.Platform = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var win = root && root.window ? root.window : (typeof window !== 'undefined' ? window : null);
  var doc = win ? win.document : null;
  var nav = win ? win.navigator : null;

  /* ---------- определение среды ---------- */
  function detect() {
    var ua = (nav && nav.userAgent) || '';
    var hasChesster = !!(win && win.Chesster);
    var tauri = hasChesster && !!(win.Chesster.tauri || win.Chesster.__TAURI__ ||
      (win.__TAURI__ || win.__TAURI_INTERNALS__));
    if (tauri) return 'tauri';
    if (hasChesster || /Chesster/i.test(ua)) return 'electron';
    if (win && win.process && win.process.versions && win.process.versions.electron) return 'electron';
    return 'browser';
  }
  var env = detect();

  function isDesktop() { return env === 'electron' || env === 'tauri'; }
  function bridge() { return (win && win.Chesster) || null; }
  function info() {
    return {
      env: env,
      desktop: isDesktop(),
      appVersion: (bridge() && bridge().appVersion) || null,
      electron: (win && win.process && win.process.versions && win.process.versions.electron) || null,
      chrome: (win && win.process && win.process.versions && win.process.versions.chrome) || null,
      ua: (nav && nav.userAgent) || ''
    };
  }

  /* ---------- обмен данными с обёрткой ---------- */
  /* Большие объекты (бинарник движка, содержимое файла) передаём через blob:,
     чтобы не сериализовать их дважды и не упираться в ограничения IPC. */
  var pending = {};
  function handoff(value) {
    if (!win || !win.URL || !win.URL.createObjectURL) return { inline: value };
    var type = typeof value === 'string' ? 'text/plain;charset=utf-8' : 'application/octet-stream';
    var blob = value instanceof Blob ? value : new Blob([value], { type: type });
    var url = win.URL.createObjectURL(blob);
    var id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    pending[id] = url;
    return { id: id, url: url, size: blob.size };
  }
  function takeHandoff(ref) {
    if (!ref) return null;
    if (ref.inline !== undefined) return ref.inline;
    var url = ref.url || (ref.id && pending[ref.id]);
    return url || null;
  }
  function releaseHandoff(ref) {
    if (!ref || !ref.id || !pending[ref.id]) return;
    try { win.URL.revokeObjectURL(pending[ref.id]); } catch (e) { }
    delete pending[ref.id];
  }

  function callBridge(name, arg) {
    var b = bridge();
    if (!b || typeof b[name] !== 'function') return Promise.resolve(null);
    try {
      var r = b[name](arg);
      return r && typeof r.then === 'function' ? r : Promise.resolve(r);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /* ---------- открытие внешних ссылок ---------- */
  function openExternal(url) {
    return callBridge('openExternal', url).then(function (handled) {
      if (handled) return { ok: true, how: 'native' };
      var w = null;
      try { w = win.open(url, '_blank', 'noopener,noreferrer'); } catch (e) { w = null; }
      if (w) return { ok: true, how: 'window' };
      return { ok: false, how: 'blocked', url: url };
    }).catch(function () {
      var w2 = null;
      try { w2 = win.open(url, '_blank', 'noopener,noreferrer'); } catch (e) { w2 = null; }
      return w2 ? { ok: true, how: 'window' } : { ok: false, how: 'blocked', url: url };
    });
  }

  /* ---------- скачивание файла ---------- */
  /* В браузере — обычный <a download>. В десктопе обёртка сама предлагает
     сохранить файл и возвращает путь; если она этого не умеет, падаем
     в браузерный способ. */
  function saveFile(filename, content, mime) {
    mime = mime || 'text/plain;charset=utf-8';
    var toBlob = function (data) { return data instanceof Blob ? data : new Blob([data], { type: mime }); };
    var deliver = function (payload) {
      return callBridge('saveFile', { name: filename, mime: mime, data: payload }).then(function (res) {
        if (res && res.saved) return { ok: true, how: 'native', path: res.path || null };
        return saveViaAnchor(filename, toBlob(payload));
      }).catch(function () { return saveViaAnchor(filename, toBlob(payload)); });
    };
    /* в IPC отдаём сырые данные (строку или ArrayBuffer): blob: URL главный
       процесс Electron прочитать не сможет */
    if (content instanceof Blob && content.arrayBuffer) {
      return content.arrayBuffer().then(function (buf) { return deliver(new Uint8Array(buf)); });
    }
    return deliver(content);
  }
  function saveViaAnchor(filename, blob) {
    var url = null;
    try {
      url = win.URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url; a.download = filename;
      a.style.display = 'none';
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { try { win.URL.revokeObjectURL(url); } catch (e) { } }, 4000);
      return { ok: true, how: 'anchor', path: null };
    } catch (e) {
      return { ok: false, how: 'failed', path: null, error: String(e && e.message || e) };
    }
  }

  /* ---------- чтение файла, выбранного пользователем ---------- */
  function readFileRef(ref) {
    if (!ref) return Promise.reject(new Error('пустая ссылка на файл'));
    var url = takeHandoff(ref);
    if (ref.text !== undefined && ref.text !== null) return Promise.resolve(String(ref.text));
    if (!url) return Promise.reject(new Error('файл недоступен'));
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return ref.binary ? r.arrayBuffer() : r.text();
    });
  }

  /* ---------- хранилище движков (IndexedDB) ---------- */
  /* Движки вроде Rodent IV весят сотни килобайт-мегабайты: в localStorage им
     не место (там бюджет архива партий). Держим их в IndexedDB, а если она
     недоступна — в памяти до перезагрузки. */
  var DB_NAME = 'chesster-engines';
  var DB_STORE = 'files';
  var memoryFallback = {};

  function idb() {
    return new Promise(function (resolve, reject) {
      if (!win || !win.indexedDB) { resolve(null); return; }
      try {
        var req = win.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function putFile(key, value) {
    return idb().then(function (db) {
      if (!db) { memoryFallback[key] = value; return 'memory'; }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(value, key);
          tx.oncomplete = function () { resolve('indexeddb'); };
          tx.onerror = function () { memoryFallback[key] = value; resolve('memory'); };
          tx.onabort = function () { memoryFallback[key] = value; resolve('memory'); };
        } catch (e) { memoryFallback[key] = value; resolve('memory'); }
      });
    });
  }
  function getFile(key) {
    if (memoryFallback[key] !== undefined) return Promise.resolve(memoryFallback[key]);
    return idb().then(function (db) {
      if (!db) return memoryFallback[key];
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readonly');
          var req = tx.objectStore(DB_STORE).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { resolve(undefined); };
        } catch (e) { resolve(undefined); }
      });
    });
  }
  function delFile(key) {
    delete memoryFallback[key];
    return idb().then(function (db) {
      if (!db) return true;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
  }

  /* ---------- оценка доступного места ---------- */
  function storageEstimate() {
    if (!nav || !nav.storage || !nav.storage.estimate) return Promise.resolve(null);
    return nav.storage.estimate().then(function (e) {
      return { usage: e.usage || 0, quota: e.quota || 0 };
    }).catch(function () { return null; });
  }
  function requestPersistent() {
    if (!nav || !nav.storage || !nav.storage.persist) return Promise.resolve(false);
    return nav.storage.persist().catch(function () { return false; });
  }

  /* ---------- полноэкранный режим ----------
     В обёртке — через IPC главному процессу, в браузере — Fullscreen API. */
  function setFullscreen(on) {
    var b = bridge();
    if (b && typeof b.setFullscreen === 'function') {
      try { b.setFullscreen(!!on); return Promise.resolve(true); } catch (e) { }
    }
    if (!doc) return Promise.resolve(false);
    try {
      if (on) {
        var el = doc.documentElement;
        if (el.requestFullscreen) return el.requestFullscreen().then(function () { return true; }, function () { return false; });
        if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return Promise.resolve(true); }
      } else {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) {
          if (doc.exitFullscreen) return doc.exitFullscreen().then(function () { return true; }, function () { return false; });
          if (doc.webkitExitFullscreen) { doc.webkitExitFullscreen(); return Promise.resolve(true); }
        }
      }
    } catch (e) { }
    return Promise.resolve(false);
  }
  function isFullscreen() {
    var b = bridge();
    if (b && typeof b.isFullscreen === 'function') {
      try { return b.isFullscreen(); } catch (e) { }
    }
    return Promise.resolve(!!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement)));
  }
  function onFullscreenChange(cb) {
    if (!win) return;
    win.addEventListener('fullscreenchange', function () { cb(!!(doc && doc.fullscreenElement)); });
  }

  /* ---------- меню и события обёртки ---------- */
  function onMenu(name, handler) {
    var b = bridge();
    if (b && typeof b.onMenu === 'function') { b.onMenu(name, handler); return true; }
    if (win) {
      win.addEventListener('chesster:menu:' + name, function (e) { handler(e.detail || {}); });
      return true;
    }
    return false;
  }

  /* ---------- нативный UCI-движок (путь десктопа) ---------- */
  function nativeEngineAvailable() {
    var b = bridge();
    return !!(b && typeof b.spawnEngine === 'function' && typeof b.engineWrite === 'function');
  }
  function pickEngineFile() {
    var b = bridge();
    if (b && typeof b.pickEngine === 'function') return b.pickEngine();
    return Promise.resolve({ canceled: true });
  }
  function spawnEngine(exePath) {
    var b = bridge();
    if (!b || typeof b.spawnEngine !== 'function') return Promise.reject(new Error('нет обёртки'));
    return b.spawnEngine(exePath);
  }
  function engineWrite(line) {
    var b = bridge();
    if (b && typeof b.engineWrite === 'function') { b.engineWrite(line); return true; }
    return false;
  }
  function engineKill() {
    var b = bridge();
    if (b && typeof b.engineKill === 'function') b.engineKill();
  }
  function onEngineLine(handler) {
    var b = bridge();
    if (b && typeof b.onEngineLine === 'function') { b.onEngineLine(handler); return true; }
    return false;
  }
  function onEngineExit(handler) {
    var b = bridge();
    if (b && typeof b.onEngineExit === 'function') { b.onEngineExit(handler); return true; }
    return false;
  }
  function onEngineError(handler) {
    var b = bridge();
    if (b && typeof b.onEngineError === 'function') { b.onEngineError(handler); return true; }
    return false;
  }

  /* ---------- жизненный цикл приложения ---------- */
  /* Выход из приложения: в обёртке закрываем окно и гасим процесс движка,
     в браузере вкладку закрыть из страницы нельзя (браузеры запрещают
     window.close для не своих окон) — честно возвращаем ok:false. */
  function closeSelf() {
    try { if (win) win.close(); } catch (e) { /* окно закрыто не будет */ }
    return Promise.resolve({ ok: false, how: 'browser' });
  }
  function quit() {
    var b = bridge();
    if (!b || typeof b.quitApp !== 'function') return closeSelf();
    return callBridge('quitApp', {}).then(function (res) {
      if (res && res.ok === false) return closeSelf();
      return { ok: true, how: 'native' };
    }).catch(function () { return closeSelf(); });
  }
  function onQuitRequested(handler) {
    if (win) win.addEventListener('before-quit', handler);
  }
  function onAppEvent(name, handler) {
    if (!win) return;
    win.addEventListener('chesster:' + name, function (e) { handler(e.detail || {}); });
  }
  function notifyReady() {
    return callBridge('appReady', { version: appVersion() }).catch(function () { });
  }
  function appVersion() {
    var b = bridge();
    return (b && b.appVersion) || (doc && doc.body && doc.body.dataset.appVersion) || null;
  }
  function setBadge(text) { return callBridge('setBadge', { text: text || '' }); }
  function setTitle(text) {
    if (doc) doc.title = text;
    return callBridge('setTitle', { text: text });
  }

  return {
    env: env, isDesktop: isDesktop, info: info, bridge: bridge,
    openExternal: openExternal, saveFile: saveFile, readFileRef: readFileRef,
    handoff: handoff, takeHandoff: takeHandoff, releaseHandoff: releaseHandoff,
    putFile: putFile, getFile: getFile, delFile: delFile,
    storageEstimate: storageEstimate, requestPersistent: requestPersistent,
    onQuitRequested: onQuitRequested, onAppEvent: onAppEvent, onMenu: onMenu,
    quit: quit,
    setFullscreen: setFullscreen, isFullscreen: isFullscreen, onFullscreenChange: onFullscreenChange,
    nativeEngineAvailable: nativeEngineAvailable, pickEngineFile: pickEngineFile,
    spawnEngine: spawnEngine, engineWrite: engineWrite, engineKill: engineKill,
    onEngineLine: onEngineLine, onEngineExit: onEngineExit, onEngineError: onEngineError,
    notifyReady: notifyReady, appVersion: appVersion, setBadge: setBadge, setTitle: setTitle
  };
});
